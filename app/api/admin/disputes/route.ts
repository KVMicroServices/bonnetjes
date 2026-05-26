export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/services/audit-log-service";
import { resolveReviewerEmail } from "@/lib/review-disable/kiyoh-review-client";
import { resolveLocationLocaleWithFallback } from "@/lib/review-disable/kiyoh-location-client";
import { sendDisputeVerifiedEmail, sendDisputeFinalRejectionEmail } from "@/lib/email/email-service";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const cursor = searchParams.get("cursor") || undefined;
    const limitParam = searchParams.get("limit");
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");

    const DEFAULT_PAGE_SIZE = 20;
    const MAX_PAGE_SIZE = 100;
    let limit = DEFAULT_PAGE_SIZE;
    if (limitParam) {
      const parsed = parseInt(limitParam, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        limit = Math.min(parsed, MAX_PAGE_SIZE);
      }
    }

    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (fromParam) {
      dateFilter.gte = new Date(fromParam);
    }
    if (toParam) {
      dateFilter.lte = new Date(toParam);
    }

    const whereClause: Record<string, unknown> = {};
    if (dateFilter.gte || dateFilter.lte) {
      whereClause.createdAt = dateFilter;
    }

    const disputes = await prisma.receiptDispute.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    const hasMore = disputes.length > limit;
    if (hasMore) {
      disputes.pop();
    }

    const nextCursor = hasMore ? disputes[disputes.length - 1].id : null;

    const receiptIds = disputes.map((dispute) => dispute.receiptId);
    const receipts = await prisma.receipt.findMany({
      where: { id: { in: receiptIds } },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });

    const receiptMap = new Map(receipts.map((receipt) => [receipt.id, receipt]));

    const enrichedDisputes = disputes.map((dispute) => {
      const receipt = receiptMap.get(dispute.receiptId);
      return {
        ...dispute,
        receipt: receipt || null,
      };
    });

    return NextResponse.json({
      disputes: enrichedDisputes,
      nextCursor,
      hasMore,
    });
  } catch (error) {
    logger.error({ error }, "Admin disputes fetch error");
    return NextResponse.json({ error: "Failed to fetch disputes" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { disputeId, action } = body as Record<string, unknown>;

    if (!disputeId || typeof disputeId !== "string" || !action || typeof action !== "string") {
      return NextResponse.json({ error: "Missing disputeId or action" }, { status: 400 });
    }

    const validActions = ["accept", "reject"];
    if (!validActions.includes(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const dispute = await prisma.receiptDispute.findUnique({
      where: { id: disputeId },
    });

    if (!dispute) {
      return NextResponse.json({ error: "Dispute not found" }, { status: 404 });
    }

    let newStatus: string;
    if (action === "accept") {
      newStatus = "verified";
    } else {
      newStatus = "rejected";
    }

    const [updatedDispute] = await prisma.$transaction([
      prisma.receiptDispute.update({
        where: { id: disputeId },
        data: { status: newStatus },
      }),
      prisma.receipt.update({
        where: { id: dispute.receiptId },
        data: { verificationStatus: newStatus },
      }),
    ]);

    recordAuditEvent("moderation", `dispute_${action}`, (session.user as any).id, {
      receiptId: dispute.receiptId,
      disputeId: disputeId,
      reviewId: dispute.reviewId,
      outcome: newStatus,
    });

    const originalSyncState = await prisma.receiptSyncState.findUnique({
      where: { reviewId: dispute.reviewId },
      select: { receiptId: true },
    });

    if (originalSyncState && originalSyncState.receiptId) {
      recordAuditEvent("moderation", `dispute_${action}`, (session.user as any).id, {
        receiptId: originalSyncState.receiptId,
        disputeReceiptId: dispute.receiptId,
        disputeId: disputeId,
        reviewId: dispute.reviewId,
        outcome: newStatus,
      });
    }

    const receipt = await prisma.receipt.findUnique({
      where: { id: dispute.receiptId },
      select: {
        extractedShopName: true,
        extractedDate: true,
        extractedAmount: true,
        failureReason: true,
      },
    });

    sendDisputeOutcomeEmail(
      dispute.reviewId,
      dispute.locationId,
      dispute.tenantId,
      newStatus,
      receipt?.failureReason || dispute.failureReason,
      receipt?.extractedShopName || null,
      receipt?.extractedDate || null,
      receipt?.extractedAmount || null
    );

    return NextResponse.json({ success: true, dispute: updatedDispute });
  } catch (error) {
    logger.error({ error }, "Admin dispute action error");
    return NextResponse.json({ error: "Failed to update dispute" }, { status: 500 });
  }
}

// ─── Dispute Outcome Email Helper ────────────────────────────────────────────

function sendDisputeOutcomeEmail(
  reviewId: string,
  locationId: string | null,
  tenantId: number | null,
  verificationStatus: string,
  failureReason: string | null,
  extractedShopName: string | null,
  extractedDate: Date | null,
  extractedAmount: number | null
): void {
  resolveAndSendDisputeEmail(
    reviewId,
    locationId,
    tenantId,
    verificationStatus,
    failureReason,
    extractedShopName,
    extractedDate,
    extractedAmount
  ).catch((error) => {
    let errorMessage: string;
    if (error instanceof Error) {
      errorMessage = error.message;
    } else {
      errorMessage = String(error);
    }
    logger.warn(
      { reviewId, error: errorMessage },
      "Unexpected error during dispute outcome email, skipping"
    );
  });
}

async function resolveAndSendDisputeEmail(
  reviewId: string,
  locationId: string | null,
  tenantId: number | null,
  verificationStatus: string,
  failureReason: string | null,
  extractedShopName: string | null,
  extractedDate: Date | null,
  extractedAmount: number | null
): Promise<void> {
  let resolvedLocationId = "";
  if (locationId) {
    resolvedLocationId = locationId;
  }
  let resolvedTenantId = 0;
  if (tenantId) {
    resolvedTenantId = tenantId;
  }

  const emailResolution = await resolveReviewerEmail(reviewId, resolvedLocationId, resolvedTenantId);

  if (!emailResolution.success || !emailResolution.email) {
    logger.warn(
      { reviewId, locationId, error: emailResolution.error },
      "Could not resolve reviewer email, skipping dispute outcome notification"
    );
    return;
  }

  const recipientEmail = emailResolution.email;

  let locale: string;
  if (resolvedLocationId.length > 0) {
    locale = await resolveLocationLocaleWithFallback(resolvedLocationId, resolvedTenantId);
  } else {
    locale = "en";
  }

  if (verificationStatus === "verified") {
    let extractedDateString: string | null = null;
    if (extractedDate) {
      const isoString = extractedDate.toISOString();
      extractedDateString = isoString.split("T")[0];
    }

    const sendResult = await sendDisputeVerifiedEmail({
      recipientEmail: recipientEmail,
      locale: locale,
      reviewId: reviewId,
      tenantId: resolvedTenantId,
      extractedShopName: extractedShopName,
      extractedDate: extractedDateString,
      extractedAmount: extractedAmount,
    });

    if (!sendResult.success) {
      logger.warn(
        { reviewId, error: sendResult.error },
        "Failed to send dispute verified email"
      );
    }
  } else if (verificationStatus === "rejected") {
    const DEFAULT_FAILURE_REASON = "VERIFICATION_FAILED";
    let resolvedFailureReason = DEFAULT_FAILURE_REASON;
    if (failureReason) {
      resolvedFailureReason = failureReason;
    }

    const sendResult = await sendDisputeFinalRejectionEmail({
      recipientEmail: recipientEmail,
      locale: locale,
      reviewId: reviewId,
      tenantId: resolvedTenantId,
      failureReason: resolvedFailureReason,
    });

    if (!sendResult.success) {
      logger.warn(
        { reviewId, error: sendResult.error },
        "Failed to send dispute final rejection email"
      );
    }
  }
}

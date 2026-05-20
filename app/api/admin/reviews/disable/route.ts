export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/db";
import {
  disableReviewByReceiptId,
  enableReviewByReceiptId,
  disableReviewManual,
  enableReviewManual,
} from "@/lib/review-disable/review-disable-service";
import { resolveReviewerEmail } from "@/lib/review-disable/kiyoh-review-client";
import { sendReviewDisableEmail } from "@/lib/email/email-service";
import { recordAuditEvent } from "@/lib/services/audit-log-service";

const disableByReceiptSchema = z.object({
  action: z.literal("disable"),
  receiptId: z.string().min(1),
});

const enableByReceiptSchema = z.object({
  action: z.literal("enable"),
  receiptId: z.string().min(1),
});

const disableManualSchema = z.object({
  action: z.literal("disable-manual"),
  reviewId: z.string().min(1),
  locationId: z.string().min(1),
  tenantId: z.number().int().positive(),
});

const enableManualSchema = z.object({
  action: z.literal("enable-manual"),
  reviewId: z.string().min(1),
  locationId: z.string().min(1),
  tenantId: z.number().int().positive(),
});

const requestSchema = z.discriminatedUnion("action", [
  disableByReceiptSchema,
  enableByReceiptSchema,
  disableManualSchema,
  enableManualSchema,
]);

const ADMIN_DISABLED_REASON = "ADMIN_DISABLED";
const DEFAULT_EMAIL_LOCALE = "en";

/**
 * Attempts to resolve the reviewer email and send a disable notification.
 * Logs warnings on failure but never throws — email is fire-and-forget.
 */
async function sendDisableNotification(
  reviewId: string,
  locationId: string,
  tenantId: number,
  failureReason: string
): Promise<void> {
  try {
    const emailResolution = await resolveReviewerEmail(reviewId, locationId, tenantId);

    if (!emailResolution.success || !emailResolution.email) {
      logger.warn(
        { reviewId, locationId, tenantId, error: emailResolution.error },
        "Could not resolve reviewer email for disable notification, skipping"
      );
      return;
    }

    const sendResult = await sendReviewDisableEmail({
      recipientEmail: emailResolution.email,
      locale: DEFAULT_EMAIL_LOCALE,
      reviewId: reviewId,
      locationId: locationId,
      tenantId: tenantId,
      failureReason: failureReason,
    });

    if (!sendResult.success) {
      logger.warn(
        { reviewId, locationId, tenantId, error: sendResult.error },
        "Failed to send review disable notification email"
      );
    }
  } catch (notificationError) {
    let errorMessage: string;
    if (notificationError instanceof Error) {
      errorMessage = notificationError.message;
    } else {
      errorMessage = String(notificationError);
    }
    logger.warn(
      { reviewId, locationId, tenantId, error: errorMessage },
      "Unexpected error during disable notification sending"
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parseResult = requestSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { success: false, error: "Invalid request body", details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const data = parseResult.data;

    logger.info({ action: data.action, data }, "Disable route handling action");

    if (data.action === "disable") {
      const result = await disableReviewByReceiptId(data.receiptId);
      logger.info({ result, receiptId: data.receiptId }, "disableReviewByReceiptId result");
      if (!result.success) {
        return NextResponse.json({ success: false, error: result.error }, { status: 404 });
      }

      const syncState = await prisma.receiptSyncState.findFirst({
        where: { receiptId: data.receiptId },
        select: { tenantId: true, locationId: true },
      });

      if (syncState && result.reviewId) {
        const receipt = await prisma.receipt.findUnique({
          where: { id: data.receiptId },
          select: { failureReason: true },
        });
        let failureReason = "VERIFICATION_FAILED";
        if (receipt && receipt.failureReason) {
          failureReason = receipt.failureReason;
        }

        sendDisableNotification(
          result.reviewId,
          syncState.locationId,
          syncState.tenantId,
          failureReason
        ).catch(() => {});
      }

      recordAuditEvent("moderation", data.action, (session.user as any).id, {
        receiptId: data.receiptId,
        action: data.action,
      });

      return NextResponse.json({ success: true, reviewId: result.reviewId });
    }

    if (data.action === "enable") {
      const result = await enableReviewByReceiptId(data.receiptId);
      logger.info({ result, receiptId: data.receiptId }, "enableReviewByReceiptId result");
      if (!result.success) {
        return NextResponse.json({ success: false, error: result.error }, { status: 404 });
      }

      recordAuditEvent("moderation", data.action, (session.user as any).id, {
        receiptId: data.receiptId,
        action: data.action,
      });

      return NextResponse.json({ success: true, reviewId: result.reviewId });
    }

    if (data.action === "disable-manual") {
      const result = await disableReviewManual(data.reviewId, data.locationId, data.tenantId);
      logger.info({ result, reviewId: data.reviewId }, "disableReviewManual result");
      if (!result.success) {
        return NextResponse.json({ success: false, error: result.error }, { status: 500 });
      }

      sendDisableNotification(
        data.reviewId,
        data.locationId,
        data.tenantId,
        ADMIN_DISABLED_REASON
      ).catch(() => {});

      recordAuditEvent("moderation", data.action, (session.user as any).id, {
        reviewId: data.reviewId,
        action: data.action,
      });

      return NextResponse.json({ success: true });
    }

    if (data.action === "enable-manual") {
      const result = await enableReviewManual(data.reviewId, data.locationId, data.tenantId);
      logger.info({ result, reviewId: data.reviewId }, "enableReviewManual result");
      if (!result.success) {
        return NextResponse.json({ success: false, error: result.error }, { status: 500 });
      }

      recordAuditEvent("moderation", data.action, (session.user as any).id, {
        reviewId: data.reviewId,
        action: data.action,
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const stack = error instanceof Error ? error.stack : undefined;
    logger.error({ error: message, stack }, "Disable route caught unhandled error");
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

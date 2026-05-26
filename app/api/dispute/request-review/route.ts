export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/db";
import { requestHumanReview, findOriginalReceiptIdByReviewId } from "@/lib/services/dispute-service";
import { resolveDisputeToken } from "@/lib/dispute/dispute-token-http";
import { recordAuditEvent } from "@/lib/services/audit-log-service";

const requestReviewSchema = z.object({
  token: z.string().min(1),
  receiptId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parseResult = requestReviewSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const { token, receiptId } = parseResult.data;

    const tokenResult = resolveDisputeToken(token);
    if (!tokenResult.success) {
      return tokenResult.response;
    }

    const result = await requestHumanReview(
      { database: prisma },
      { payload: tokenResult.payload, receiptId }
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.statusCode });
    }

    recordAuditEvent("system", "dispute_human_review_requested", undefined, {
      receiptId: result.receiptId,
      reviewId: tokenResult.payload.reviewId,
    });

    const originalReceiptId = await findOriginalReceiptIdByReviewId(prisma, tokenResult.payload.reviewId);
    if (originalReceiptId) {
      recordAuditEvent("system", "dispute_human_review_requested", undefined, {
        receiptId: originalReceiptId,
        disputeReceiptId: result.receiptId,
        reviewId: tokenResult.payload.reviewId,
      });
    }

    return NextResponse.json({
      receiptId: result.receiptId,
      verificationStatus: result.verificationStatus,
    });
  } catch (error) {
    logger.error({ error }, "Dispute request-review error");
    return NextResponse.json({ error: "Failed to request review" }, { status: 500 });
  }
}

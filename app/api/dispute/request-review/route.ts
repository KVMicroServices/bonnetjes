export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/db";
import { requestHumanReview } from "@/lib/services/dispute-service";
import { resolveDisputeToken } from "@/lib/dispute/dispute-token-http";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, receiptId } = body;

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

    return NextResponse.json({
      receiptId: result.receiptId,
      verificationStatus: result.verificationStatus,
    });
  } catch (error) {
    logger.error({ error }, "Dispute request-review error");
    return NextResponse.json({ error: "Failed to request review" }, { status: 500 });
  }
}

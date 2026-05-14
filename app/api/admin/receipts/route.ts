export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { disableReviewByReceiptId } from "@/lib/review-disable/review-disable-service";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isAdmin = (session.user as any).role === "admin";
    if (!isAdmin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const receipts = await prisma.receipt.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, name: true, email: true } }
      }
    });

    return NextResponse.json(receipts);
  } catch (error) {
    logger.error({ error }, "Admin receipts error");
    return NextResponse.json({ error: "Failed to fetch receipts" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const isAdmin = (session.user as any).role === "admin";
    if (!isAdmin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id, verificationStatus } = await request.json();
    const updated = await prisma.receipt.update({
      where: { id },
      data: { verificationStatus }
    });

    // Check if auto-disable is enabled and receipt was rejected
    const autoDisableEnabled = process.env.RECEIPT_AUTO_DISABLE_ENABLED === "true";
    if (autoDisableEnabled && verificationStatus === "rejected") {
      disableReviewByReceiptId(id).catch((error) => {
        logger.error({ error, receiptId: id }, "Auto-disable review failed (non-blocking)");
      });
    }

    // Check if a linked ReceiptSyncState exists for this receipt
    const syncState = await prisma.receiptSyncState.findFirst({
      where: { receiptId: id },
      select: { reviewId: true },
    });
    const canDisableReview = syncState !== null;

    return NextResponse.json({ ...updated, canDisableReview });
  } catch (error) {
    logger.error({ error }, "Admin receipt update error");
    return NextResponse.json({ error: "Failed to update receipt" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { disableReviewByReceiptId } from "@/lib/review-disable/review-disable-service";
import { isAutoDisableEnabled, isLocationAllowedForAutoDisable } from "@/lib/services/app-settings-service";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const receipts = await prisma.receipt.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, name: true, email: true } }
      }
    });

    const response = NextResponse.json(receipts);
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    return response;
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

    const { id, verificationStatus } = await request.json();
    const updated = await prisma.receipt.update({
      where: { id },
      data: { verificationStatus }
    });

    // Check if auto-disable is enabled and receipt was rejected
    const autoDisableEnabled = await isAutoDisableEnabled();
    if (autoDisableEnabled && verificationStatus === "rejected") {
      const syncState = await prisma.receiptSyncState.findFirst({
        where: { receiptId: id },
        select: { reviewId: true, locationId: true },
      });
      const canDisableReview = syncState !== null;

      if (canDisableReview) {
        const locationAllowed = await isLocationAllowedForAutoDisable(syncState.locationId);
        if (locationAllowed) {
          disableReviewByReceiptId(id).catch((error) => {
            logger.error({ error, receiptId: id }, "Auto-disable review failed (non-blocking)");
          });
        }
      }

      return NextResponse.json({ ...updated, canDisableReview });
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

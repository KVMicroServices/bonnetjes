export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

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

    const DEFAULT_PAGE_SIZE = 10;
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

    const whereClause: Record<string, unknown> = {
      verificationStatus: "requires_review",
    };
    if (dateFilter.gte || dateFilter.lte) {
      whereClause.createdAt = dateFilter;
    }

    const receipts = await prisma.receipt.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });

    const hasMore = receipts.length > limit;
    if (hasMore) {
      receipts.pop();
    }

    const nextCursor = hasMore ? receipts[receipts.length - 1].id : null;

    // Enrich with locationId from ReceiptSyncState
    const receiptIds = receipts.map((receipt) => receipt.id);
    const syncStates = await prisma.receiptSyncState.findMany({
      where: { receiptId: { in: receiptIds } },
      select: { receiptId: true, locationId: true },
    });
    const locationIdMap = new Map(
      syncStates.map((state) => [state.receiptId, state.locationId])
    );

    const enrichedReceipts = receipts.map((receipt) => {
      const locationId = locationIdMap.get(receipt.id);
      return {
        ...receipt,
        locationId: locationId || null,
      };
    });

    return NextResponse.json({
      receipts: enrichedReceipts,
      nextCursor,
      hasMore,
    });
  } catch (error) {
    logger.error({ error }, "Admin review-required fetch error");
    return NextResponse.json(
      { error: "Failed to fetch review-required receipts" },
      { status: 500 }
    );
  }
}

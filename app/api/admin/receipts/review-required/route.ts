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

    const isAdmin = (session.user as any).role === "admin";
    if (!isAdmin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const searchParams = request.nextUrl.searchParams;
    const cursor = searchParams.get("cursor") || undefined;
    const limitParam = searchParams.get("limit");
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");

    const DEFAULT_PAGE_SIZE = 10;
    let limit = DEFAULT_PAGE_SIZE;
    if (limitParam) {
      const parsed = parseInt(limitParam, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        limit = parsed;
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

    return NextResponse.json({
      receipts,
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

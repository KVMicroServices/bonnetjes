export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as any).id;

    const bookmarks = await prisma.bookmark.findMany({
      where: { userId },
      select: { receiptId: true },
      orderBy: { createdAt: "desc" },
    });

    const receiptIds = bookmarks.map((bookmark) => bookmark.receiptId);

    return NextResponse.json({ bookmarkedReceiptIds: receiptIds });
  } catch (error) {
    logger.error({ error }, "Failed to fetch bookmarks");
    return NextResponse.json(
      { error: "Failed to fetch bookmarks" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as any).id;
    const body = await request.json();
    const { receiptId } = body;

    if (!receiptId || typeof receiptId !== "string") {
      return NextResponse.json(
        { error: "receiptId is required" },
        { status: 400 }
      );
    }

    const receipt = await prisma.receipt.findUnique({
      where: { id: receiptId },
      select: { id: true },
    });

    if (!receipt) {
      return NextResponse.json(
        { error: "Receipt not found" },
        { status: 404 }
      );
    }

    const bookmark = await prisma.bookmark.upsert({
      where: {
        userId_receiptId: { userId, receiptId },
      },
      create: { userId, receiptId },
      update: {},
    });

    return NextResponse.json({ bookmark }, { status: 201 });
  } catch (error) {
    logger.error({ error }, "Failed to create bookmark");
    return NextResponse.json(
      { error: "Failed to create bookmark" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as any).id;
    const { searchParams } = request.nextUrl;
    const receiptId = searchParams.get("receiptId");

    if (!receiptId) {
      return NextResponse.json(
        { error: "receiptId is required" },
        { status: 400 }
      );
    }

    await prisma.bookmark.deleteMany({
      where: { userId, receiptId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Failed to delete bookmark");
    return NextResponse.json(
      { error: "Failed to delete bookmark" },
      { status: 500 }
    );
  }
}

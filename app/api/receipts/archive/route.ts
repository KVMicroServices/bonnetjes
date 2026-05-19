export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import { getFileUrl, getFileAsBuffer } from "@/lib/s3";
import { archiveReceipts, listArchivedReceipts } from "@/lib/services/receipt-service";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as any).id;
    const isAdmin = (session.user as any).role === "admin";
    const { receiptIds } = await request.json();

    const result = await archiveReceipts(
      { database: prisma, storage: { getFileUrl, getFileAsBuffer } },
      receiptIds,
      userId,
      isAdmin
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: result.statusCode }
      );
    }

    return NextResponse.json({
      success: true,
      archivedCount: result.archivedCount
    });
  } catch (error) {
    console.error("Archive error:", error);
    return NextResponse.json(
      { error: "Failed to archive receipts" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as any).id;
    const isAdmin = (session.user as any).role === "admin";

    const result = await listArchivedReceipts(
      { database: prisma, storage: { getFileUrl, getFileAsBuffer } },
      userId,
      isAdmin
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json(result.grouped);
  } catch (error) {
    console.error("Fetch archive error:", error);
    return NextResponse.json(
      { error: "Failed to fetch archived receipts" },
      { status: 500 }
    );
  }
}

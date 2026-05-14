export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import { getFileAsBuffer, getFileUrl } from "@/lib/s3";
import {
  calculateImageHash,
  checkForDuplicates,
  analyzeMetadata,
  detectSuspiciousPatterns,
  calculateFraudRiskScore
} from "@/lib/fraud-detection";
import { listReceipts, createReceipt } from "@/lib/services/receipt-service";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as any).id;
    const isAdmin = (session.user as any).role === "admin";

    const searchParams = request.nextUrl.searchParams;
    const cursor = searchParams.get("cursor") || undefined;
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : 15;

    const result = await listReceipts(
      { database: prisma, storage: { getFileUrl, getFileAsBuffer } },
      userId,
      isAdmin,
      { cursor, limit }
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      receipts: result.receipts,
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    });
  } catch (error) {
    console.error("Get receipts error:", error);
    return NextResponse.json(
      { error: "Failed to fetch receipts" },
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

    const result = await createReceipt(
      { database: prisma, storage: { getFileUrl, getFileAsBuffer } },
      userId,
      body,
      {
        calculateImageHash,
        checkForDuplicates,
        analyzeMetadata,
        detectSuspiciousPatterns,
        calculateFraudRiskScore
      }
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: result.statusCode }
      );
    }

    return NextResponse.json(result.receipt, { status: 201 });
  } catch (error) {
    console.error("Create receipt error:", error);
    return NextResponse.json(
      { error: "Failed to create receipt" },
      { status: 500 }
    );
  }
}

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
import { enqueueReceiptProcessing } from "@/lib/queue";

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
    const rawSearch = searchParams.get("search") || undefined;
    let limit = 15;
    if (limitParam) {
      limit = parseInt(limitParam, 10);
    }

    const MAX_SEARCH_LENGTH = 100;
    let search = rawSearch;
    if (search && search.length > MAX_SEARCH_LENGTH) {
      search = search.slice(0, MAX_SEARCH_LENGTH);
    }

    const result = await listReceipts(
      { database: prisma, storage: { getFileUrl, getFileAsBuffer } },
      userId,
      isAdmin,
      { cursor, limit, search }
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      );
    }

    const DEFAULT_POLL_INTERVAL_SECONDS = 300;
    const pollIntervalSecondsRaw = parseInt(process.env.POLL_INTERVAL_SECONDS || "", 10);
    let pollIntervalSeconds = DEFAULT_POLL_INTERVAL_SECONDS;
    if (Number.isFinite(pollIntervalSecondsRaw)) {
      pollIntervalSeconds = pollIntervalSecondsRaw;
    }

    const response = NextResponse.json({
      receipts: result.receipts,
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
      pollIntervalSeconds,
    });
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    return response;
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

    // Enqueue async OCR + fraud re-scoring
    await enqueueReceiptProcessing(result.receipt.id, userId);

    return NextResponse.json(result.receipt, { status: 201 });
  } catch (error) {
    console.error("Create receipt error:", error);
    return NextResponse.json(
      { error: "Failed to create receipt" },
      { status: 500 }
    );
  }
}

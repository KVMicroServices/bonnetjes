export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import { getFileAsBuffer, getFileUrl } from "@/lib/s3";
import { getReceipt, updateReceiptStatus } from "@/lib/services/receipt-service";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const userId = (session.user as any).id;
    const isAdmin = (session.user as any).role === "admin";

    const result = await getReceipt(
      { database: prisma, storage: { getFileUrl, getFileAsBuffer } },
      id,
      userId,
      isAdmin
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: result.statusCode }
      );
    }

    return NextResponse.json(result.receipt);
  } catch (error) {
    console.error("Get receipt error:", error);
    return NextResponse.json(
      { error: "Failed to fetch receipt" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const isAdmin = (session.user as any).role === "admin";

    if (!isAdmin) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { verificationStatus, notes } = body;

    const result = await updateReceiptStatus(
      { database: prisma, storage: { getFileUrl, getFileAsBuffer } },
      id,
      (session.user as any).id,
      verificationStatus,
      notes
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: result.statusCode }
      );
    }

    return NextResponse.json(result.receipt);
  } catch (error) {
    console.error("Update receipt error:", error);
    return NextResponse.json(
      { error: "Failed to update receipt" },
      { status: 500 }
    );
  }
}

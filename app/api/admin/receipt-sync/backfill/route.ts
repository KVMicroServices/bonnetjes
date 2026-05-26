export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { executeBackfill } from "@/lib/services/receipt-sync-service";

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const tenantId = body.tenantId;
    const force = body.force === true;
    const days = typeof body.days === "number" && Number.isFinite(body.days) ? body.days : undefined;

    if (tenantId === undefined || tenantId === null || typeof tenantId !== "number" || !Number.isFinite(tenantId)) {
      return NextResponse.json(
        { error: "tenantId must be a valid number" },
        { status: 400 }
      );
    }

    const result = await executeBackfill({ database: prisma }, tenantId, force, days);

    if (!result.success) {
      const responseBody: Record<string, unknown> = { error: result.error };
      if (result.currentWatermark) {
        responseBody.currentWatermark = result.currentWatermark;
      }
      return NextResponse.json(responseBody, { status: result.statusCode });
    }

    return NextResponse.json(result.data, { status: 200 });
  } catch (error: unknown) {
    logger.error({ error }, "Backfill endpoint failed");
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}

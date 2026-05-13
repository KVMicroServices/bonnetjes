export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { logger } from "@/lib/logger";
import { getWatermark, upsertWatermark } from "@/lib/receipt-sync/state-repository";
import { executeTick } from "@/lib/receipt-sync";

// ─── Constants ────────────────────────────────────────────────────────────────

const BACKFILL_DAYS = 30;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const BACKFILL_WINDOW_MILLISECONDS = BACKFILL_DAYS * MILLISECONDS_PER_DAY;

// ─── Backfill Handler ─────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = (session.user as { role?: string }).role;
    if (userRole !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const body = await request.json();
    const tenantId = body.tenantId;
    const force = body.force === true;

    if (tenantId === undefined || tenantId === null || typeof tenantId !== "number" || !Number.isFinite(tenantId)) {
      return NextResponse.json(
        { error: "tenantId must be a valid number" },
        { status: 400 }
      );
    }

    const existingWatermark = await getWatermark(tenantId);

    if (existingWatermark && !force) {
      const now = new Date();
      const watermarkAgeMilliseconds = now.getTime() - existingWatermark.watermark.getTime();
      const isWithinBackfillWindow = watermarkAgeMilliseconds < BACKFILL_WINDOW_MILLISECONDS;

      if (isWithinBackfillWindow) {
        return NextResponse.json(
          {
            error: "Watermark is already within 30 days. Use force: true to override.",
            currentWatermark: existingWatermark.watermark.toISOString(),
          },
          { status: 409 }
        );
      }
    }

    const backfillWatermark = new Date(Date.now() - BACKFILL_WINDOW_MILLISECONDS);
    await upsertWatermark(tenantId, backfillWatermark);

    logger.info(
      { tenantId, backfillWatermark: backfillWatermark.toISOString(), force },
      "Backfill initiated, executing immediate tick"
    );

    const tickResults = await executeTick();

    return NextResponse.json(
      {
        message: "Backfill completed",
        watermarkSetTo: backfillWatermark.toISOString(),
        tickResults: tickResults,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    logger.error({ error }, "Backfill endpoint failed");
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}

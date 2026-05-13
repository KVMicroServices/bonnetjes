export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { loadSyncConfiguration } from "@/lib/receipt-sync/config";

// ─── Constants ────────────────────────────────────────────────────────────────

const HEALTH_THRESHOLD_MULTIPLIER = 2;
const MILLISECONDS_PER_SECOND = 1000;
const DEFAULT_POLL_INTERVAL_SECONDS = 300;

// ─── Health Check Handler ─────────────────────────────────────────────────────

export async function GET() {
  try {
    const configuration = loadSyncConfiguration();
    const pollIntervalSeconds = configuration
      ? configuration.pollIntervalSeconds
      : DEFAULT_POLL_INTERVAL_SECONDS;

    const lastCompletedTick = await prisma.receiptSyncTick.findFirst({
      where: { completedAt: { not: null } },
      orderBy: { completedAt: "desc" },
    });

    const latestWatermark = await prisma.receiptSyncWatermark.findFirst({
      orderBy: { watermark: "desc" },
    });

    const now = new Date();
    const thresholdMilliseconds = HEALTH_THRESHOLD_MULTIPLIER * pollIntervalSeconds * MILLISECONDS_PER_SECOND;

    let watermarkAgeSeconds: number | null = null;
    if (latestWatermark) {
      const watermarkAgeMilliseconds = now.getTime() - latestWatermark.watermark.getTime();
      watermarkAgeSeconds = Math.floor(watermarkAgeMilliseconds / MILLISECONDS_PER_SECOND);
    }

    if (!lastCompletedTick || !lastCompletedTick.completedAt) {
      return NextResponse.json(
        {
          status: "unhealthy",
          lastTickCompletedAt: null,
          watermarkAgeSeconds: watermarkAgeSeconds,
          pollIntervalSeconds: pollIntervalSeconds,
        },
        { status: 503 }
      );
    }

    const tickAgeMilliseconds = now.getTime() - lastCompletedTick.completedAt.getTime();
    const isHealthy = tickAgeMilliseconds <= thresholdMilliseconds;

    if (isHealthy) {
      return NextResponse.json(
        {
          status: "healthy",
          lastTickCompletedAt: lastCompletedTick.completedAt.toISOString(),
          watermarkAgeSeconds: watermarkAgeSeconds,
          pollIntervalSeconds: pollIntervalSeconds,
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        status: "unhealthy",
        lastTickCompletedAt: lastCompletedTick.completedAt.toISOString(),
        watermarkAgeSeconds: watermarkAgeSeconds,
        pollIntervalSeconds: pollIntervalSeconds,
      },
      { status: 503 }
    );
  } catch (error: unknown) {
    logger.error({ error }, "Health check failed");
    return NextResponse.json(
      { status: "unhealthy", error: "Internal error" },
      { status: 503 }
    );
  }
}

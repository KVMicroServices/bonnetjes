import { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";
import { loadSyncConfiguration } from "@/lib/receipt-sync/config";
import { executeTick } from "@/lib/receipt-sync";
import type { SyncTickResult } from "@/lib/receipt-sync/types";

// ─── Dependencies ────────────────────────────────────────────────────────────

export interface ReceiptSyncServiceDependencies {
  database: PrismaClient;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const HEALTH_THRESHOLD_MULTIPLIER = 2;
const MILLISECONDS_PER_SECOND = 1000;
const DEFAULT_POLL_INTERVAL_SECONDS = 300;
const DEFAULT_BACKFILL_DAYS = 5;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

// ─── Result Types ────────────────────────────────────────────────────────────

export interface HealthStatusData {
  status: "healthy" | "unhealthy";
  lastTickCompletedAt: string | null;
  watermarkAgeSeconds: number | null;
  pollIntervalSeconds: number;
}

export interface BackfillResultData {
  message: string;
  watermarkSetTo: string;
  tickResults: ReadonlyArray<SyncTickResult>;
}

export type GetHealthStatusResult =
  | { success: true; healthy: true; data: HealthStatusData }
  | { success: true; healthy: false; data: HealthStatusData }
  | { success: false; error: string };

export type ExecuteBackfillResult =
  | { success: true; data: BackfillResultData }
  | { success: false; error: string; statusCode: number; currentWatermark?: string };

// ─── Service Functions ───────────────────────────────────────────────────────

/** Determine sync service health based on last tick recency. */
export async function getHealthStatus(
  dependencies: ReceiptSyncServiceDependencies
): Promise<GetHealthStatusResult> {
  const database = dependencies.database;

  const configuration = loadSyncConfiguration();
  let pollIntervalSeconds: number;
  if (configuration) {
    pollIntervalSeconds = configuration.pollIntervalSeconds;
  } else {
    pollIntervalSeconds = DEFAULT_POLL_INTERVAL_SECONDS;
  }

  const lastCompletedTick = await database.receiptSyncTick.findFirst({
    where: { completedAt: { not: null } },
    orderBy: { completedAt: "desc" },
  });

  const latestWatermark = await database.receiptSyncWatermark.findFirst({
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
    return {
      success: true,
      healthy: false,
      data: {
        status: "unhealthy",
        lastTickCompletedAt: null,
        watermarkAgeSeconds,
        pollIntervalSeconds,
      },
    };
  }

  const tickAgeMilliseconds = now.getTime() - lastCompletedTick.completedAt.getTime();
  const isHealthy = tickAgeMilliseconds <= thresholdMilliseconds;

  return {
    success: true,
    healthy: isHealthy,
    data: {
      status: isHealthy ? "healthy" : "unhealthy",
      lastTickCompletedAt: lastCompletedTick.completedAt.toISOString(),
      watermarkAgeSeconds,
      pollIntervalSeconds,
    },
  };
}

/** Execute a backfill: set watermark to N days ago and trigger an immediate tick. */
export async function executeBackfill(
  dependencies: ReceiptSyncServiceDependencies,
  tenantId: number,
  force: boolean,
  days?: number
): Promise<ExecuteBackfillResult> {
  const database = dependencies.database;
  const backfillDays = days || DEFAULT_BACKFILL_DAYS;
  const backfillWindowMilliseconds = backfillDays * MILLISECONDS_PER_DAY;

  const existingWatermark = await database.receiptSyncWatermark.findUnique({
    where: { tenantId },
  });

  if (existingWatermark && !force) {
    const now = new Date();
    const watermarkAgeMilliseconds = now.getTime() - existingWatermark.watermark.getTime();
    const isWithinBackfillWindow = watermarkAgeMilliseconds < backfillWindowMilliseconds;

    if (isWithinBackfillWindow) {
      return {
        success: false,
        error: `Watermark is already within ${backfillDays} days. Use force: true to override.`,
        statusCode: 409,
        currentWatermark: existingWatermark.watermark.toISOString(),
      };
    }
  }

  const backfillWatermark = new Date(Date.now() - backfillWindowMilliseconds);

  await database.receiptSyncWatermark.upsert({
    where: { tenantId },
    create: { tenantId, watermark: backfillWatermark },
    update: { watermark: backfillWatermark },
  });

  logger.info(
    { tenantId, backfillWatermark: backfillWatermark.toISOString(), force },
    "Backfill initiated, executing immediate tick"
  );

  const tickResults = await executeTick();

  return {
    success: true,
    data: {
      message: "Backfill completed",
      watermarkSetTo: backfillWatermark.toISOString(),
      tickResults,
    },
  };
}

import { prisma } from "@/lib/db";
import type { ReviewSyncStatus } from "./types";

// ─── State Record Types ───────────────────────────────────────────────────────

export interface SyncStateRecord {
  readonly id: string;
  readonly reviewId: string;
  readonly tenantId: number;
  readonly locationId: string;
  readonly status: string;
  readonly s3Key: string | null;
  readonly s3Etag: string | null;
  readonly attemptCount: number;
  readonly processedAt: Date;
  readonly errorMessage: string | null;
  readonly receiptContent: string | null;
  readonly receiptId: string | null;
}

export interface WatermarkRecord {
  readonly id: string;
  readonly tenantId: number;
  readonly watermark: Date;
}

export interface TickRecord {
  readonly id: string;
  readonly tenantId: number;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly locationsDiscovered: number;
  readonly reviewsDiscovered: number;
  readonly receiptsProcessed: number;
  readonly noReceiptCount: number;
  readonly failedCount: number;
  readonly errorMessage: string | null;
}

// ─── State Repository ─────────────────────────────────────────────────────────

export async function getStateByReviewId(reviewId: string): Promise<SyncStateRecord | null> {
  const record = await prisma.receiptSyncState.findUnique({
    where: { reviewId },
  });

  return record;
}

export async function upsertState(params: {
  reviewId: string;
  tenantId: number;
  locationId: string;
  status: ReviewSyncStatus;
  s3Key?: string | null;
  s3Etag?: string | null;
  attemptCount?: number;
  errorMessage?: string | null;
  receiptContent?: string | null;
  receiptId?: string | null;
}): Promise<SyncStateRecord> {
  const record = await prisma.receiptSyncState.upsert({
    where: { reviewId: params.reviewId },
    create: {
      reviewId: params.reviewId,
      tenantId: params.tenantId,
      locationId: params.locationId,
      status: params.status,
      s3Key: params.s3Key || null,
      s3Etag: params.s3Etag || null,
      attemptCount: params.attemptCount || 0,
      errorMessage: params.errorMessage || null,
      receiptContent: params.receiptContent || null,
      receiptId: params.receiptId || null,
      processedAt: new Date(),
    },
    update: {
      status: params.status,
      s3Key: params.s3Key || null,
      s3Etag: params.s3Etag || null,
      attemptCount: params.attemptCount || 0,
      errorMessage: params.errorMessage || null,
      receiptContent: params.receiptContent || null,
      receiptId: params.receiptId || null,
      processedAt: new Date(),
    },
  });

  return record;
}

// ─── Watermark Operations ─────────────────────────────────────────────────────

export async function getWatermark(tenantId: number): Promise<WatermarkRecord | null> {
  const record = await prisma.receiptSyncWatermark.findUnique({
    where: { tenantId },
  });

  return record;
}

export async function upsertWatermark(tenantId: number, watermark: Date): Promise<WatermarkRecord> {
  const record = await prisma.receiptSyncWatermark.upsert({
    where: { tenantId },
    create: {
      tenantId,
      watermark,
    },
    update: {
      watermark,
    },
  });

  return record;
}

// ─── Tick Operations ──────────────────────────────────────────────────────────

export async function createTick(tenantId: number): Promise<TickRecord> {
  const record = await prisma.receiptSyncTick.create({
    data: {
      tenantId,
      startedAt: new Date(),
    },
  });

  return record;
}

export async function completeTick(params: {
  tickId: string;
  locationsDiscovered: number;
  reviewsDiscovered: number;
  receiptsProcessed: number;
  noReceiptCount: number;
  failedCount: number;
  errorMessage?: string | null;
}): Promise<TickRecord> {
  const record = await prisma.receiptSyncTick.update({
    where: { id: params.tickId },
    data: {
      completedAt: new Date(),
      locationsDiscovered: params.locationsDiscovered,
      reviewsDiscovered: params.reviewsDiscovered,
      receiptsProcessed: params.receiptsProcessed,
      noReceiptCount: params.noReceiptCount,
      failedCount: params.failedCount,
      errorMessage: params.errorMessage || null,
    },
  });

  return record;
}

// ─── Failed State Retrieval ───────────────────────────────────────────────────

export async function getFailedStatesForRetry(
  tenantId: number,
  maxRetryAttempts: number
): Promise<ReadonlyArray<SyncStateRecord>> {
  const records = await prisma.receiptSyncState.findMany({
    where: {
      tenantId,
      status: "FAILED",
      attemptCount: {
        lt: maxRetryAttempts,
      },
    },
  });

  return records;
}

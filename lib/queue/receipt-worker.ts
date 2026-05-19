import { Worker, Job } from "bullmq";
import { getRedisConnection } from "./connection";
import { RECEIPT_PROCESSING_QUEUE } from "./receipt-queue";
import type { ReceiptProcessingJobData } from "./receipt-queue";
import { enqueueReviewDisable } from "./review-disable-queue";
import { prisma } from "@/lib/db";
import { getFileAsBuffer } from "@/lib/s3";
import { processReceiptOcr } from "@/lib/services/ocr-service";
import {
  detectSuspiciousPatterns,
  calculateFraudRiskScore,
} from "@/lib/fraud-detection";
import { isAutoDisableEnabled, isLocationAllowedForAutoDisable } from "@/lib/services/app-settings-service";
import { logger } from "@/lib/logger";

// ─── KV-Sync Storage Routing ─────────────────────────────────────────────────

const KV_SYNC_PATH_PREFIX = "kv-sync:";

async function getFileAsBufferWithKvRouting(cloudStoragePath: string): Promise<Buffer> {
  if (!cloudStoragePath.startsWith(KV_SYNC_PATH_PREFIX)) {
    return getFileAsBuffer(cloudStoragePath);
  }

  const { KvS3Client } = await import("@/lib/receipt-sync/kv-s3-client");

  const bucketName = process.env.KV_RECEIPT_S3_BUCKET_NAME || "";
  if (bucketName.length === 0) {
    throw new Error("KV_RECEIPT_S3_BUCKET_NAME not configured, cannot fetch kv-sync receipt");
  }

  const s3Key = cloudStoragePath.substring(KV_SYNC_PATH_PREFIX.length);
  const kvS3Client = new KvS3Client({
    kvReceiptS3BucketName: bucketName,
    kvReceiptAwsRegion: process.env.KV_RECEIPT_AWS_REGION || "eu-central-1",
  });
  return kvS3Client.getReceiptContent(s3Key);
}

// ─── Worker Configuration ────────────────────────────────────────────────────

const DEFAULT_CONCURRENCY = 3;

function getWorkerConcurrency(): number {
  const raw = parseInt(process.env.QUEUE_WORKER_CONCURRENCY || "", 10);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  return DEFAULT_CONCURRENCY;
}

// ─── Job Processor ───────────────────────────────────────────────────────────

async function processReceiptJob(job: Job<ReceiptProcessingJobData>): Promise<void> {
  const { receiptId, userId } = job.data;

  logger.info({ receiptId, jobId: job.id }, "Processing receipt job started");

  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
  });

  if (!receipt) {
    logger.warn({ receiptId }, "Receipt not found, skipping job");
    return;
  }

  if (receipt.verificationStatus !== "pending") {
    logger.info({ receiptId, status: receipt.verificationStatus }, "Receipt already processed, skipping");
    return;
  }

  // Update status to indicate processing has started
  await prisma.receipt.update({
    where: { id: receiptId },
    data: { processingStatus: "processing" },
  });

  try {
    // Run OCR processing (includes fraud re-scoring with OCR confidence)
    const ocrResult = await processReceiptOcr(
      {
        database: prisma,
        storage: { getFileAsBuffer: getFileAsBufferWithKvRouting },
        fraudDetection: { detectSuspiciousPatterns, calculateFraudRiskScore },
      },
      receiptId
    );

    if (!ocrResult.success) {
      logger.error({ receiptId, error: ocrResult.error }, "OCR processing failed");

      await prisma.receipt.update({
        where: { id: receiptId },
        data: { processingStatus: "failed" },
      });
      throw new Error(ocrResult.error);
    }

    // Mark processing as complete
    await prisma.receipt.update({
      where: { id: receiptId },
      data: { processingStatus: "completed" },
    });

    // Auto-disable: if rejected and secondary analysis confirms, enqueue disable job
    if (ocrResult.verificationStatus === "rejected") {
      const autoDisableEnabled = await isAutoDisableEnabled();
      if (autoDisableEnabled) {
        await enqueueAutoDisableIfEligible(receiptId);
      }
    }

    logger.info(
      { receiptId, verificationStatus: ocrResult.verificationStatus },
      "Receipt processing completed"
    );
  } catch (error) {
    await prisma.receipt.update({
      where: { id: receiptId },
      data: { processingStatus: "failed" },
    });
    throw error;
  }
}

// ─── Auto-Disable Helper ─────────────────────────────────────────────────────

const SECONDARY_VERDICT_CONFIRMED = "confirmed_rejection";
const HARD_RULE_FAILURE_REASONS = ["DUPLICATE_RECEIPT", "RECEIPT_TOO_OLD"];

/**
 * Checks if a rejected receipt is eligible for auto-disable. Eligible if:
 * - Hard rule rejection (duplicate or date too old), OR
 * - Secondary analysis confirmed the rejection
 *
 * Then verifies a linked ReceiptSyncState exists and location is allowed.
 */
async function enqueueAutoDisableIfEligible(receiptId: string): Promise<void> {
  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    select: { secondaryAnalysis: true, failureReason: true },
  });

  if (!receipt) {
    return;
  }

  const isHardRuleRejection = receipt.failureReason !== null
    && HARD_RULE_FAILURE_REASONS.includes(receipt.failureReason);

  let isSecondaryConfirmed = false;
  if (receipt.secondaryAnalysis) {
    try {
      const parsed = JSON.parse(receipt.secondaryAnalysis);
      isSecondaryConfirmed = parsed.verdict === SECONDARY_VERDICT_CONFIRMED;
    } catch {
      isSecondaryConfirmed = receipt.secondaryAnalysis.includes("Initial analysis valid");
    }
  }

  if (!isHardRuleRejection && !isSecondaryConfirmed) {
    logger.info(
      { receiptId },
      "Rejection not confirmed by hard rule or secondary analysis, skipping auto-disable"
    );
    return;
  }

  const syncState = await prisma.receiptSyncState.findFirst({
    where: { receiptId },
  });

  if (!syncState) {
    logger.info(
      { receiptId },
      "No ReceiptSyncState linked to receipt, skipping auto-disable"
    );
    return;
  }

  const locationAllowed = await isLocationAllowedForAutoDisable(syncState.locationId);
  if (!locationAllowed) {
    logger.info(
      { receiptId, locationId: syncState.locationId },
      "Location not in auto-disable whitelist, skipping"
    );
    return;
  }

  // Create audit record
  await prisma.reviewDisableAudit.create({
    data: {
      receiptId,
      reviewId: syncState.reviewId,
      locationId: syncState.locationId,
      tenantId: syncState.tenantId,
      status: "pending",
    },
  });

  await enqueueReviewDisable({
    receiptId,
    reviewId: syncState.reviewId,
    locationId: syncState.locationId,
    tenantId: syncState.tenantId,
  });

  logger.info(
    { receiptId, reviewId: syncState.reviewId, locationId: syncState.locationId },
    "Enqueued review disable after confirmed rejection"
  );
}

// ─── Worker Lifecycle ────────────────────────────────────────────────────────

let workerInstance: Worker<ReceiptProcessingJobData> | null = null;

/** Start the receipt processing worker. */
export function startReceiptWorker(): Worker<ReceiptProcessingJobData> {
  if (workerInstance) {
    return workerInstance;
  }

  const connection = getRedisConnection();
  const concurrency = getWorkerConcurrency();

  workerInstance = new Worker<ReceiptProcessingJobData>(
    RECEIPT_PROCESSING_QUEUE,
    processReceiptJob,
    {
      connection,
      concurrency,
    }
  );

  workerInstance.on("completed", (job) => {
    logger.info({ jobId: job.id, receiptId: job.data.receiptId }, "Job completed");
  });

  workerInstance.on("failed", (job, error) => {
    let receiptId = "unknown";
    if (job) {
      receiptId = job.data.receiptId;
    }
    logger.error({ jobId: job?.id, receiptId, error: error.message }, "Job failed");
  });

  workerInstance.on("error", (error) => {
    logger.error({ error: error.message }, "Worker error");
  });

  logger.info({ concurrency, queue: RECEIPT_PROCESSING_QUEUE }, "Receipt worker started");

  return workerInstance;
}

/** Stop the receipt processing worker gracefully. */
export async function stopReceiptWorker(): Promise<void> {
  if (workerInstance) {
    await workerInstance.close();
    workerInstance = null;
    logger.info("Receipt worker stopped");
  }
}

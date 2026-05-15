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
import { logger } from "@/lib/logger";

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
        storage: { getFileAsBuffer },
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
      const autoDisableEnabled = process.env.RECEIPT_AUTO_DISABLE_ENABLED === "true";
      if (autoDisableEnabled) {
        await enqueueReviewDisableIfConfirmed(receiptId);
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

const SECONDARY_ANALYSIS_CONFIRMED = "Initial analysis valid";

/**
 * Checks if a rejected receipt has confirmed secondary analysis and a linked
 * ReceiptSyncState. If so, creates an audit record and enqueues the disable job.
 */
async function enqueueReviewDisableIfConfirmed(receiptId: string): Promise<void> {
  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    select: { secondaryAnalysis: true },
  });

  if (!receipt) {
    return;
  }

  const isConfirmed = receipt.secondaryAnalysis
    && receipt.secondaryAnalysis.includes(SECONDARY_ANALYSIS_CONFIRMED);

  if (!isConfirmed) {
    logger.info(
      { receiptId },
      "Secondary analysis did not confirm rejection, skipping auto-disable"
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

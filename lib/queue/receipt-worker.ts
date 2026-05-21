import { Worker, Job } from "bullmq";
import { getRedisConnection } from "./connection";
import { RECEIPT_PROCESSING_QUEUE } from "./receipt-queue";
import type { ReceiptProcessingJobData } from "./receipt-queue";
import { enqueueReviewDisable } from "./review-disable-queue";
import { prisma } from "@/lib/db";
import { getFileAsBuffer, uploadBuffer, generatePreviewStoragePath } from "@/lib/s3";
import { processReceiptOcr } from "@/lib/services/ocr-service";
import {
  detectSuspiciousPatterns,
  calculateFraudRiskScore,
} from "@/lib/fraud-detection";
import { isAutoDisableEnabled, isLocationAllowedForAutoDisable } from "@/lib/services/app-settings-service";
import { needsConversion, convertToViewableFormat } from "@/lib/file-conversion";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/services/audit-log-service";
import { resolveReviewerEmail } from "@/lib/review-disable/kiyoh-review-client";
import { resolveLocationLocaleWithFallback } from "@/lib/review-disable/kiyoh-location-client";
import { sendReceiptVerifiedEmail } from "@/lib/email/email-service";

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
    // Generate preview image for non-browser-viewable formats (HEIC, DOC, DOCX)
    const originalFilename = receipt.originalFilename || "receipt";
    if (needsConversion(originalFilename) && !receipt.previewStoragePath) {
      try {
        const fileBuffer = await getFileAsBufferWithKvRouting(receipt.cloudStoragePath);
        const conversionResult = await convertToViewableFormat(fileBuffer, originalFilename);

        if (conversionResult.success) {
          const previewPath = generatePreviewStoragePath(
            receipt.cloudStoragePath,
            conversionResult.extension
          );

          await uploadBuffer(conversionResult.buffer, previewPath, conversionResult.mimeType);

          await prisma.receipt.update({
            where: { id: receiptId },
            data: { previewStoragePath: previewPath },
          });

          logger.info(
            { receiptId, previewPath },
            "Preview image generated and stored"
          );
        } else {
          logger.warn(
            { receiptId, error: conversionResult.error },
            "Preview generation failed, continuing with OCR"
          );
        }
      } catch (previewError) {
        const errorMessage = previewError instanceof Error ? previewError.message : String(previewError);
        logger.warn(
          { receiptId, error: errorMessage },
          "Preview generation threw, continuing with OCR"
        );
      }
    }

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

    // Send verified email notification to the reviewer
    if (ocrResult.verificationStatus === "verified") {
      await sendVerifiedNotificationEmail(receiptId);
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
      if (typeof parsed.verdict === "string") {
        isSecondaryConfirmed = parsed.verdict === SECONDARY_VERDICT_CONFIRMED;
      }
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

  recordAuditEvent("system", "auto_disable_enqueued", undefined, {
    receiptId,
    reviewId: syncState.reviewId,
  });

  logger.info(
    { receiptId, reviewId: syncState.reviewId, locationId: syncState.locationId },
    "Enqueued review disable after confirmed rejection"
  );
}

// ─── Verified Email Helper ───────────────────────────────────────────────────

async function sendVerifiedNotificationEmail(receiptId: string): Promise<void> {
  try {
    const syncState = await prisma.receiptSyncState.findFirst({
      where: { receiptId },
    });

    if (!syncState) {
      logger.info(
        { receiptId },
        "No ReceiptSyncState linked to receipt, skipping verified email"
      );
      return;
    }

    const locationAllowed = await isLocationAllowedForAutoDisable(syncState.locationId);
    if (!locationAllowed) {
      logger.info(
        { receiptId, locationId: syncState.locationId },
        "Location not in whitelist, skipping verified email"
      );
      return;
    }

    const emailResolution = await resolveReviewerEmail(
      syncState.reviewId,
      syncState.locationId,
      syncState.tenantId
    );

    if (!emailResolution.success || !emailResolution.email) {
      logger.warn(
        { receiptId, reviewId: syncState.reviewId, error: emailResolution.error },
        "Could not resolve reviewer email, skipping verified notification"
      );
      return;
    }

    const locale = await resolveLocationLocaleWithFallback(
      syncState.locationId,
      syncState.tenantId
    );

    const receipt = await prisma.receipt.findUnique({
      where: { id: receiptId },
      select: { extractedShopName: true, extractedDate: true, extractedAmount: true },
    });

    let extractedShopName: string | null = null;
    let extractedDate: string | null = null;
    let extractedAmount: number | null = null;

    if (receipt) {
      extractedShopName = receipt.extractedShopName;
      if (receipt.extractedDate) {
        const isoString = receipt.extractedDate.toISOString();
        extractedDate = isoString.split("T")[0];
      }
      extractedAmount = receipt.extractedAmount;
    }

    const sendResult = await sendReceiptVerifiedEmail({
      recipientEmail: emailResolution.email,
      locale: locale,
      reviewId: syncState.reviewId,
      tenantId: syncState.tenantId,
      extractedShopName: extractedShopName,
      extractedDate: extractedDate,
      extractedAmount: extractedAmount,
    });

    if (!sendResult.success) {
      logger.warn(
        { receiptId, reviewId: syncState.reviewId, error: sendResult.error },
        "Failed to send receipt verified notification email"
      );
    }
  } catch (notificationError) {
    let errorMessage: string;
    if (notificationError instanceof Error) {
      errorMessage = notificationError.message;
    } else {
      errorMessage = String(notificationError);
    }
    logger.warn(
      { receiptId, error: errorMessage },
      "Unexpected error during verified email notification, skipping"
    );
  }
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

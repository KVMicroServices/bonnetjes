import { Worker, Job } from "bullmq";
import { getRedisConnection } from "./connection";
import { REVIEW_DISABLE_QUEUE } from "./review-disable-queue";
import type { ReviewDisableJobData } from "./review-disable-queue";
import { prisma } from "@/lib/db";
import { disableReviewByReceiptId } from "@/lib/review-disable/review-disable-service";
import { resolveReviewerEmail } from "@/lib/review-disable/kiyoh-review-client";
import { sendReviewDisableEmail } from "@/lib/email/email-service";
import { logger } from "@/lib/logger";

// ─── Worker Configuration ────────────────────────────────────────────────────

const WORKER_CONCURRENCY = 1;

// ─── Job Processor ───────────────────────────────────────────────────────────

async function processReviewDisableJob(job: Job<ReviewDisableJobData>): Promise<void> {
  const { receiptId, reviewId, locationId, tenantId } = job.data;
  const attemptNumber = job.attemptsMade + 1;

  logger.info(
    { receiptId, reviewId, locationId, tenantId, attempt: attemptNumber, jobId: job.id },
    "Processing review disable job"
  );

  // Update audit record with current attempt count
  await prisma.reviewDisableAudit.updateMany({
    where: { receiptId, reviewId, status: "pending" },
    data: { attempts: attemptNumber },
  });

  const result = await disableReviewByReceiptId(receiptId);

  if (!result.success) {
    // Update audit with error
    await prisma.reviewDisableAudit.updateMany({
      where: { receiptId, reviewId, status: "pending" },
      data: { lastError: result.error || "Unknown error", attempts: attemptNumber },
    });

    logger.error(
      { receiptId, reviewId, error: result.error, attempt: attemptNumber },
      "Review disable attempt failed"
    );

    throw new Error(result.error || "Review disable failed");
  }

  // Mark audit as successful
  await prisma.reviewDisableAudit.updateMany({
    where: { receiptId, reviewId, status: "pending" },
    data: { status: "success", completedAt: new Date(), attempts: attemptNumber },
  });

  logger.info(
    { receiptId, reviewId, attempt: attemptNumber },
    "Review disable completed successfully"
  );

  // ─── Email Notification ──────────────────────────────────────────────────

  await sendDisableNotificationEmail(receiptId, reviewId, locationId, tenantId);
}

// ─── Email Notification Helper ─────────────────────────────────────────────

const DEFAULT_FAILURE_REASON = "VERIFICATION_FAILED";
const EMAIL_LOCALE = "en";

async function sendDisableNotificationEmail(
  receiptId: string,
  reviewId: string,
  locationId: string,
  tenantId: number
): Promise<void> {
  try {
    const emailResolution = await resolveReviewerEmail(reviewId, locationId, tenantId);

    if (!emailResolution.success || !emailResolution.email) {
      logger.warn(
        { receiptId, reviewId, locationId, error: emailResolution.error },
        "Could not resolve reviewer email, skipping notification"
      );
      return;
    }

    const recipientEmail = emailResolution.email;

    let failureReason = DEFAULT_FAILURE_REASON;
    try {
      const receipt = await prisma.receipt.findUnique({
        where: { id: receiptId },
        select: { failureReason: true },
      });

      if (receipt && receipt.failureReason) {
        failureReason = receipt.failureReason;
      }
    } catch (receiptLookupError) {
      const errorMessage = receiptLookupError instanceof Error
        ? receiptLookupError.message
        : String(receiptLookupError);
      logger.warn(
        { receiptId, reviewId, error: errorMessage },
        "Failed to look up receipt failureReason, using default"
      );
    }

    const sendResult = await sendReviewDisableEmail({
      recipientEmail: recipientEmail,
      locale: EMAIL_LOCALE,
      reviewId: reviewId,
      locationId: locationId,
      failureReason: failureReason,
    });

    if (!sendResult.success) {
      logger.warn(
        { receiptId, reviewId, error: sendResult.error },
        "Failed to send disable notification email"
      );
    }
  } catch (notificationError) {
    const errorMessage = notificationError instanceof Error
      ? notificationError.message
      : String(notificationError);
    logger.warn(
      { receiptId, reviewId, error: errorMessage },
      "Unexpected error during email notification, skipping"
    );
  }
}

// ─── Worker Lifecycle ────────────────────────────────────────────────────────

let workerInstance: Worker<ReviewDisableJobData> | null = null;

/** Start the review disable worker. */
export function startReviewDisableWorker(): Worker<ReviewDisableJobData> {
  if (workerInstance) {
    return workerInstance;
  }

  const connection = getRedisConnection();

  workerInstance = new Worker<ReviewDisableJobData>(
    REVIEW_DISABLE_QUEUE,
    processReviewDisableJob,
    {
      connection,
      concurrency: WORKER_CONCURRENCY,
    }
  );

  workerInstance.on("completed", (job) => {
    logger.info(
      { jobId: job.id, receiptId: job.data.receiptId, reviewId: job.data.reviewId },
      "Review disable job completed"
    );
  });

  workerInstance.on("failed", (job, error) => {
    let receiptId = "unknown";
    let reviewId = "unknown";
    let isFinalAttempt = false;

    if (job) {
      receiptId = job.data.receiptId;
      reviewId = job.data.reviewId;
      isFinalAttempt = job.attemptsMade >= (job.opts.attempts || 5);
    }

    if (isFinalAttempt && job) {
      // Mark audit as permanently failed
      prisma.reviewDisableAudit.updateMany({
        where: { receiptId: job.data.receiptId, reviewId: job.data.reviewId, status: "pending" },
        data: { status: "failed", lastError: error.message, completedAt: new Date() },
      }).catch((dbError) => {
        logger.error({ dbError }, "Failed to update audit record on final failure");
      });
    }

    logger.error(
      { jobId: job?.id, receiptId, reviewId, error: error.message, isFinalAttempt },
      "Review disable job failed"
    );
  });

  workerInstance.on("error", (error) => {
    logger.error({ error: error.message }, "Review disable worker error");
  });

  logger.info(
    { concurrency: WORKER_CONCURRENCY, queue: REVIEW_DISABLE_QUEUE },
    "Review disable worker started"
  );

  return workerInstance;
}

/** Stop the review disable worker gracefully. */
export async function stopReviewDisableWorker(): Promise<void> {
  if (workerInstance) {
    await workerInstance.close();
    workerInstance = null;
    logger.info("Review disable worker stopped");
  }
}

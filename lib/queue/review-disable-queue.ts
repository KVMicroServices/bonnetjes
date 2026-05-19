import { Queue } from "bullmq";
import { getRedisConnection } from "./connection";

// ─── Queue Names ─────────────────────────────────────────────────────────────

export const REVIEW_DISABLE_QUEUE = "review-disable";

// ─── Job Types ───────────────────────────────────────────────────────────────

export interface ReviewDisableJobData {
  receiptId: string;
  reviewId: string;
  locationId: string;
  tenantId: number;
}

// ─── Configuration ───────────────────────────────────────────────────────────

const DEFAULT_MAX_ATTEMPTS = 5;
const BASE_BACKOFF_DELAY_MILLISECONDS = 10000;
const COMPLETED_JOB_RETENTION_SECONDS = 604800;
const COMPLETED_JOB_MAX_COUNT = 5000;
const FAILED_JOB_RETENTION_SECONDS = 2592000;

function getMaxAttempts(): number {
  const raw = parseInt(process.env.MAX_RETRY_ATTEMPTS || "", 10);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  return DEFAULT_MAX_ATTEMPTS;
}

// ─── Queue Instance ──────────────────────────────────────────────────────────

let queueInstance: Queue<ReviewDisableJobData> | null = null;

/** Get or create the review disable queue. */
export function getReviewDisableQueue(): Queue<ReviewDisableJobData> {
  if (queueInstance) {
    return queueInstance;
  }

  const connection = getRedisConnection();

  queueInstance = new Queue<ReviewDisableJobData>(REVIEW_DISABLE_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: getMaxAttempts(),
      backoff: {
        type: "exponential",
        delay: BASE_BACKOFF_DELAY_MILLISECONDS,
      },
      removeOnComplete: {
        age: COMPLETED_JOB_RETENTION_SECONDS,
        count: COMPLETED_JOB_MAX_COUNT,
      },
      removeOnFail: {
        age: FAILED_JOB_RETENTION_SECONDS,
      },
    },
  });

  return queueInstance;
}

/** Enqueue a review disable job after confirmed rejection. */
export async function enqueueReviewDisable(
  data: ReviewDisableJobData
): Promise<string> {
  const queue = getReviewDisableQueue();

  const job = await queue.add(
    "disable-review",
    data,
    { jobId: `disable-${data.receiptId}-${data.reviewId}` }
  );

  return job.id || data.reviewId;
}

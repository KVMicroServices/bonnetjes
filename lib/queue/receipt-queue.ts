import { Queue } from "bullmq";
import { getRedisConnection } from "./connection";
import { prisma } from "@/lib/db";

// ─── Queue Names ─────────────────────────────────────────────────────────────

export const RECEIPT_PROCESSING_QUEUE = "receipt-processing";

// ─── Constants ───────────────────────────────────────────────────────────────

const COMPLETED_JOB_RETENTION_SECONDS = 86400;
const COMPLETED_JOB_MAX_COUNT = 1000;
const FAILED_JOB_RETENTION_SECONDS = 604800;
const RETRY_BACKOFF_DELAY_MILLISECONDS = 5000;

// ─── Job Types ───────────────────────────────────────────────────────────────

export interface ReceiptProcessingJobData {
  receiptId: string;
  userId: string;
}

// ─── Queue Instance ──────────────────────────────────────────────────────────

let queueInstance: Queue<ReceiptProcessingJobData> | null = null;

/** Get or create the receipt processing queue. */
export function getReceiptProcessingQueue(): Queue<ReceiptProcessingJobData> {
  if (queueInstance) {
    return queueInstance;
  }

  const connection = getRedisConnection();

  queueInstance = new Queue<ReceiptProcessingJobData>(RECEIPT_PROCESSING_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: RETRY_BACKOFF_DELAY_MILLISECONDS,
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

/** Enqueue a receipt for OCR + fraud detection processing. */
export async function enqueueReceiptProcessing(
  receiptId: string,
  userId: string
): Promise<string> {
  const queue = getReceiptProcessingQueue();

  await prisma.receipt.update({
    where: { id: receiptId },
    data: { queuedAt: new Date() },
  });

  const job = await queue.add(
    "process-receipt",
    { receiptId, userId },
    { jobId: `receipt-${receiptId}` }
  );

  return job.id || receiptId;
}

import { Queue } from "bullmq";
import { getRedisConnection } from "./connection";

// ─── Queue Names ─────────────────────────────────────────────────────────────

export const RECEIPT_PROCESSING_QUEUE = "receipt-processing";

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
        delay: 5000,
      },
      removeOnComplete: {
        age: 86400,
        count: 1000,
      },
      removeOnFail: {
        age: 604800,
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

  const job = await queue.add(
    "process-receipt",
    { receiptId, userId },
    { jobId: `receipt-${receiptId}` }
  );

  return job.id || receiptId;
}

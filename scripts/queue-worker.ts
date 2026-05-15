/**
 * Standalone queue worker process.
 * Runs outside the Next.js server to process receipt OCR and fraud detection jobs.
 *
 * Usage: tsx scripts/queue-worker.ts
 * Or in production: node scripts/queue-worker.js (after build)
 */

import { startReceiptWorker, stopReceiptWorker } from "@/lib/queue/receipt-worker";
import { startReviewDisableWorker, stopReviewDisableWorker } from "@/lib/queue/review-disable-worker";
import { closeRedisConnection } from "@/lib/queue/connection";
import { logger } from "@/lib/logger";

logger.info("Starting queue worker process...");

startReceiptWorker();
startReviewDisableWorker();

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Shutdown signal received, closing workers...");

  await stopReceiptWorker();
  await stopReviewDisableWorker();
  await closeRedisConnection();

  logger.info("Worker shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled rejection in worker");
});

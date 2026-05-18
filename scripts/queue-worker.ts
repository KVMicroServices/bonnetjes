/**
 * Standalone queue worker process.
 * Runs outside the Next.js server to process receipt OCR and fraud detection jobs.
 *
 * Usage: tsx scripts/queue-worker.ts
 * Or in production: node scripts/queue-worker.js (after build)
 */

import http from "node:http";
import { startReceiptWorker, stopReceiptWorker } from "@/lib/queue/receipt-worker";
import { startReviewDisableWorker, stopReviewDisableWorker } from "@/lib/queue/review-disable-worker";
import { closeRedisConnection } from "@/lib/queue/connection";
import { logger } from "@/lib/logger";

// ─── Constants ───────────────────────────────────────────────────────────────

const HEALTH_PORT = parseInt(process.env.WORKER_HEALTH_PORT || "3001", 10);

// ─── Startup Validation ──────────────────────────────────────────────────────

if (!process.env.REDIS_URL) {
  logger.warn(
    "REDIS_URL is not set — falling back to localhost:6379. Set REDIS_URL in production."
  );
}

logger.info("Starting queue worker process...");

startReceiptWorker();
startReviewDisableWorker();

// ─── Health Check Server ─────────────────────────────────────────────────────

const healthServer = http.createServer((request, response) => {
  if (request.url === "/health" && request.method === "GET") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "ok", service: "queue-worker" }));
    return;
  }

  response.writeHead(404);
  response.end();
});

healthServer.listen(HEALTH_PORT, () => {
  logger.info({ port: HEALTH_PORT }, "Worker health check server listening");
});

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Shutdown signal received, closing workers...");

  healthServer.close();
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

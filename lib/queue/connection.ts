import IORedis from "ioredis";
import { logger } from "@/lib/logger";

const DEFAULT_REDIS_URL = "redis://localhost:6379";

let connectionInstance: IORedis | null = null;

/** Get or create the shared Redis connection for BullMQ. */
export function getRedisConnection(): IORedis {
  if (connectionInstance) {
    return connectionInstance;
  }

  const redisUrl = process.env.REDIS_URL || DEFAULT_REDIS_URL;

  connectionInstance = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  connectionInstance.on("error", (error) => {
    logger.error({ error: error.message }, "Redis connection error");
  });

  connectionInstance.on("connect", () => {
    logger.info("Redis connected");
  });

  return connectionInstance;
}

/** Close the Redis connection (for graceful shutdown). */
export async function closeRedisConnection(): Promise<void> {
  if (connectionInstance) {
    await connectionInstance.quit();
    connectionInstance = null;
  }
}

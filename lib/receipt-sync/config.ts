import { logger } from "@/lib/logger";
import type { SyncConfiguration, TenantToken } from "./types";

// ─── Default Values ───────────────────────────────────────────────────────────

const DEFAULT_KV_RECEIPT_AWS_REGION = "eu-central-1";
const DEFAULT_POLL_INTERVAL_SECONDS = 300;
const DEFAULT_WATERMARK_SAFETY_SECONDS = 60;
const DEFAULT_PAGE_SIZE = 200;
const DEFAULT_WORKER_CONCURRENCY = 4;
const DEFAULT_API_RATE_LIMIT_SECONDS = 1;
const DEFAULT_RECEIPT_AUTO_VERIFY_ENABLED = false;
const DEFAULT_MAX_RETRY_ATTEMPTS = 5;

// ─── Token Parsing ────────────────────────────────────────────────────────────

function parseTenantTokens(rawValue: string): ReadonlyArray<TenantToken> {
  const pairs = rawValue.split(",");
  const tokens: TenantToken[] = [];

  for (const pair of pairs) {
    const trimmedPair = pair.trim();
    if (trimmedPair.length === 0) {
      continue;
    }

    const separatorIndex = trimmedPair.indexOf(":");
    if (separatorIndex === -1) {
      logger.warn({ pair: trimmedPair }, "Invalid tenant token pair format, expected tenantId:token");
      continue;
    }

    const tenantIdString = trimmedPair.substring(0, separatorIndex);
    const token = trimmedPair.substring(separatorIndex + 1);
    const tenantId = parseInt(tenantIdString, 10);

    if (isNaN(tenantId)) {
      logger.warn({ tenantIdString }, "Invalid tenant ID, must be a number");
      continue;
    }

    if (token.length === 0) {
      logger.warn({ tenantId }, "Empty token for tenant");
      continue;
    }

    tokens.push({ tenantId, token });
  }

  return tokens;
}

// ─── Configuration Loading ────────────────────────────────────────────────────

export function loadSyncConfiguration(): SyncConfiguration | null {
  const kvApiBaseUrl = process.env.KV_API_BASE_URL;
  if (!kvApiBaseUrl) {
    logger.warn("KV_API_BASE_URL is not set, sync service will not start");
    return null;
  }

  const rawTokens = process.env.KV_PUBLICATION_API_TOKENS;
  if (!rawTokens) {
    logger.warn("KV_PUBLICATION_API_TOKENS is not set, sync service will not start");
    return null;
  }

  const kvPublicationApiTokens = parseTenantTokens(rawTokens);
  if (kvPublicationApiTokens.length === 0) {
    logger.warn("No valid tenant tokens parsed from KV_PUBLICATION_API_TOKENS");
    return null;
  }

  const kvReceiptS3BucketName = process.env.KV_RECEIPT_S3_BUCKET_NAME || "";
  if (kvReceiptS3BucketName.length === 0) {
    logger.warn("KV_RECEIPT_S3_BUCKET_NAME is not set, S3 receipt fetching will be disabled");
  }

  const kvReceiptAwsRegion = process.env.KV_RECEIPT_AWS_REGION || DEFAULT_KV_RECEIPT_AWS_REGION;

  const pollIntervalSeconds = parseIntegerWithDefault(
    process.env.POLL_INTERVAL_SECONDS,
    DEFAULT_POLL_INTERVAL_SECONDS
  );

  const watermarkSafetySeconds = parseIntegerWithDefault(
    process.env.WATERMARK_SAFETY_SECONDS,
    DEFAULT_WATERMARK_SAFETY_SECONDS
  );

  const pageSize = parseIntegerWithDefault(
    process.env.PAGE_SIZE,
    DEFAULT_PAGE_SIZE
  );

  const workerConcurrency = parseIntegerWithDefault(
    process.env.WORKER_CONCURRENCY,
    DEFAULT_WORKER_CONCURRENCY
  );

  const apiRateLimitSeconds = parseIntegerWithDefault(
    process.env.API_RATE_LIMIT,
    DEFAULT_API_RATE_LIMIT_SECONDS
  );

  const receiptAutoVerifyEnabled = parseBooleanWithDefault(
    process.env.RECEIPT_AUTO_VERIFY_ENABLED,
    DEFAULT_RECEIPT_AUTO_VERIFY_ENABLED
  );

  const maxRetryAttempts = parseIntegerWithDefault(
    process.env.MAX_RETRY_ATTEMPTS,
    DEFAULT_MAX_RETRY_ATTEMPTS
  );

  return {
    kvApiBaseUrl,
    kvPublicationApiTokens,
    kvReceiptS3BucketName,
    kvReceiptAwsRegion,
    pollIntervalSeconds,
    watermarkSafetySeconds,
    pageSize,
    workerConcurrency,
    apiRateLimitSeconds,
    receiptAutoVerifyEnabled,
    maxRetryAttempts,
  };
}

// ─── Parsing Helpers ──────────────────────────────────────────────────────────

function parseIntegerWithDefault(value: string | undefined, defaultValue: number): number {
  if (!value) {
    return defaultValue;
  }

  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    return defaultValue;
  }

  return parsed;
}

function parseBooleanWithDefault(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) {
    return defaultValue;
  }

  return value.toLowerCase() === "true";
}

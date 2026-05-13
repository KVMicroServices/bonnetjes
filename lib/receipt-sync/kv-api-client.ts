import { logger } from "@/lib/logger";
import type { LocationDto, ReviewDto, SyncConfiguration } from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_API_RETRY_ATTEMPTS = 3;
const INITIAL_BACKOFF_MILLISECONDS = 1000;
const BACKOFF_MULTIPLIER = 2;
const HTTP_STATUS_TOO_MANY_REQUESTS = 429;
const HTTP_STATUS_SERVER_ERROR_THRESHOLD = 500;
const HTTP_STATUS_CLIENT_ERROR_THRESHOLD = 400;

// ─── Rate Limiter ─────────────────────────────────────────────────────────────

export class TokenBucketRateLimiter {
  private lastRequestTimestamp: number = 0;
  private readonly minimumIntervalMilliseconds: number;

  constructor(rateLimitSeconds: number) {
    this.minimumIntervalMilliseconds = rateLimitSeconds * 1000;
  }

  async waitForToken(): Promise<void> {
    const now = Date.now();
    const elapsedSinceLastRequest = now - this.lastRequestTimestamp;
    const remainingWaitTime = this.minimumIntervalMilliseconds - elapsedSinceLastRequest;

    if (remainingWaitTime > 0) {
      await sleep(remainingWaitTime);
    }

    this.lastRequestTimestamp = Date.now();
  }
}

// ─── KV API Client ───────────────────────────────────────────────────────────

export class KvApiClient {
  private readonly baseUrl: string;
  private readonly pageSize: number;
  private readonly rateLimiter: TokenBucketRateLimiter;

  constructor(configuration: SyncConfiguration) {
    this.baseUrl = configuration.kvApiBaseUrl;
    this.pageSize = configuration.pageSize;
    this.rateLimiter = new TokenBucketRateLimiter(configuration.apiRateLimitSeconds);
  }

  async *fetchLocationsLatest(
    token: string,
    dateSince: Date,
    pageSize: number
  ): AsyncGenerator<ReadonlyArray<LocationDto>> {
    let page = 1;
    let hasMorePages = true;

    while (hasMorePages) {
      const url = buildLocationsUrl(this.baseUrl, dateSince, pageSize, page);
      const response = await this.executeRequestWithRetry(url, token);

      if (response === null) {
        return;
      }

      const locations: LocationDto[] = response as LocationDto[];
      yield locations;

      if (locations.length < pageSize) {
        hasMorePages = false;
      } else {
        page = page + 1;
      }
    }
  }

  async *fetchReviewsForLocation(
    token: string,
    locationId: string,
    dateSince: Date,
    pageSize: number
  ): AsyncGenerator<ReadonlyArray<ReviewDto>> {
    let page = 1;
    let hasMorePages = true;

    while (hasMorePages) {
      const url = buildReviewsUrl(this.baseUrl, locationId, dateSince, pageSize, page);
      const response = await this.executeRequestWithRetry(url, token);

      if (response === null) {
        return;
      }

      const reviews: ReviewDto[] = response as ReviewDto[];
      yield reviews;

      if (reviews.length < pageSize) {
        hasMorePages = false;
      } else {
        page = page + 1;
      }
    }
  }

  private async executeRequestWithRetry(url: string, token: string): Promise<unknown | null> {
    let attemptCount = 0;

    while (attemptCount < MAX_API_RETRY_ATTEMPTS) {
      await this.rateLimiter.waitForToken();

      try {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            "X-Publication-Api-Token": token,
            "Accept": "application/json",
          },
        });

        if (response.ok) {
          const body = await response.json();
          return body;
        }

        if (response.status === HTTP_STATUS_TOO_MANY_REQUESTS) {
          const retryAfterHeader = response.headers.get("Retry-After");
          const retryAfterSeconds = parseRetryAfterHeader(retryAfterHeader);
          logger.warn(
            { url, retryAfterSeconds },
            "KV API returned 429, waiting before retry"
          );
          await sleep(retryAfterSeconds * 1000);
          attemptCount = attemptCount + 1;
          continue;
        }

        if (response.status >= HTTP_STATUS_SERVER_ERROR_THRESHOLD) {
          attemptCount = attemptCount + 1;
          const backoffMilliseconds = calculateExponentialBackoff(attemptCount);
          logger.warn(
            { url, status: response.status, attempt: attemptCount, backoffMilliseconds },
            "KV API returned server error, retrying with backoff"
          );
          await sleep(backoffMilliseconds);
          continue;
        }

        if (response.status >= HTTP_STATUS_CLIENT_ERROR_THRESHOLD) {
          logger.error(
            { url, status: response.status },
            "KV API returned client error, not retrying"
          );
          return null;
        }

        return null;
      } catch (error: unknown) {
        attemptCount = attemptCount + 1;

        if (attemptCount >= MAX_API_RETRY_ATTEMPTS) {
          logger.error(
            { url, error, attempt: attemptCount },
            "KV API request failed after max retries"
          );
          return null;
        }

        const backoffMilliseconds = calculateExponentialBackoff(attemptCount);
        logger.warn(
          { url, error, attempt: attemptCount, backoffMilliseconds },
          "KV API network error, retrying with backoff"
        );
        await sleep(backoffMilliseconds);
      }
    }

    return null;
  }
}

// ─── URL Builders ─────────────────────────────────────────────────────────────

function buildLocationsUrl(
  baseUrl: string,
  dateSince: Date,
  pageSize: number,
  page: number
): string {
  const dateSinceIso = dateSince.toISOString();
  return `${baseUrl}/v1/review/feed/locations/latest?dateSince=${encodeURIComponent(dateSinceIso)}&limit=${pageSize}&page=${page}`;
}

function buildReviewsUrl(
  baseUrl: string,
  locationId: string,
  dateSince: Date,
  pageSize: number,
  page: number
): string {
  const dateSinceIso = dateSince.toISOString();
  return `${baseUrl}/v1/review/feed/locations/${encodeURIComponent(locationId)}/reviews/external?dateSince=${encodeURIComponent(dateSinceIso)}&limit=${pageSize}&page=${page}`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseRetryAfterHeader(headerValue: string | null): number {
  const DEFAULT_RETRY_AFTER_SECONDS = 60;

  if (!headerValue) {
    return DEFAULT_RETRY_AFTER_SECONDS;
  }

  const parsed = parseInt(headerValue, 10);
  if (isNaN(parsed)) {
    return DEFAULT_RETRY_AFTER_SECONDS;
  }

  return parsed;
}

function calculateExponentialBackoff(attemptNumber: number): number {
  return INITIAL_BACKOFF_MILLISECONDS * Math.pow(BACKOFF_MULTIPLIER, attemptNumber - 1);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

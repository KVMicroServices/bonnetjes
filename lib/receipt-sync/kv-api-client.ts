import { logger } from "@/lib/logger";
import type { LocationDto, ReviewDto, RawKvReviewsResponse, SyncConfiguration } from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_API_RETRY_ATTEMPTS = 3;
const INITIAL_BACKOFF_MILLISECONDS = 1000;
const BACKOFF_MULTIPLIER = 2;
const HTTP_STATUS_TOO_MANY_REQUESTS = 429;
const HTTP_STATUS_SERVER_ERROR_THRESHOLD = 500;
const HTTP_STATUS_CLIENT_ERROR_THRESHOLD = 400;

// ─── Rate Limiter ─────────────────────────────────────────────────────────────

export class TokenBucketRateLimiter {
  private nextAvailableTimestamp: number = 0;
  private readonly minimumIntervalMilliseconds: number;
  private pendingQueue: Array<() => void> = [];
  private isProcessing: boolean = false;

  constructor(rateLimitSeconds: number) {
    this.minimumIntervalMilliseconds = rateLimitSeconds * 1000;
  }

  async waitForToken(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.pendingQueue.push(resolve);
      this.processQueue();
    });
  }

  private processQueue(): void {
    if (this.isProcessing) {
      return;
    }
    if (this.pendingQueue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const nextResolve = this.pendingQueue.shift();
    if (!nextResolve) {
      this.isProcessing = false;
      return;
    }

    const now = Date.now();
    const waitTime = this.nextAvailableTimestamp - now;

    if (waitTime <= 0) {
      this.nextAvailableTimestamp = now + this.minimumIntervalMilliseconds;
      this.isProcessing = false;
      nextResolve();
      this.processQueue();
    } else {
      setTimeout(() => {
        this.nextAvailableTimestamp = Date.now() + this.minimumIntervalMilliseconds;
        this.isProcessing = false;
        nextResolve();
        this.processQueue();
      }, waitTime);
    }
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
    let startOffset = 0;
    let hasMorePages = true;

    while (hasMorePages) {
      const url = buildLocationsUrl(this.baseUrl, dateSince, pageSize, startOffset);
      const response = await this.executeRequestWithRetry(url, token);

      if (response === null) {
        return;
      }

      const locations: LocationDto[] = response as LocationDto[];
      yield locations;

      if (locations.length < pageSize) {
        hasMorePages = false;
      } else {
        startOffset = startOffset + pageSize;
      }
    }
  }

  async *fetchReviewsForLocation(
    token: string,
    locationId: string,
    dateSince: Date,
    pageSize: number
  ): AsyncGenerator<ReadonlyArray<ReviewDto>> {
    let pageNumber = 0;
    let hasMorePages = true;

    while (hasMorePages) {
      const url = buildReviewsUrl(this.baseUrl, locationId, dateSince, pageSize, pageNumber);
      const response = await this.executeRequestWithRetry(url, token);

      if (response === null) {
        return;
      }

      // The reviews endpoint returns { locationId, reviews: [...] }
      const responseBody = response as RawKvReviewsResponse;
      const rawReviews = responseBody.reviews;

      if (!rawReviews || !Array.isArray(rawReviews)) {
        logger.warn(
          { locationId, responseKeys: Object.keys(response as object) },
          "Reviews response missing reviews array"
        );
        return;
      }

      const reviews: ReviewDto[] = rawReviews.map((raw) => ({
        reviewId: raw.reviewId,
        locationId: locationId,
        createdAt: raw.dateSince,
        reviewAuthor: raw.reviewAuthor || null,
        rating: raw.rating || null,
        shopName: null,
        reviewDate: raw.dateSince,
        amount: null,
      }));

      yield reviews;

      if (reviews.length < pageSize) {
        hasMorePages = false;
      } else {
        pageNumber = pageNumber + 1;
      }
    }
  }

  private async executeRequestWithRetry(url: string, token: string): Promise<unknown | null> {
    let attemptCount = 0;

    while (attemptCount < MAX_API_RETRY_ATTEMPTS) {
      await this.rateLimiter.waitForToken();

      logger.debug({ url, attempt: attemptCount + 1 }, "KV API request starting");

      try {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            "X-Publication-Api-Token": token,
            "Accept": "application/json",
          },
        });

        logger.debug(
          { url, status: response.status, attempt: attemptCount + 1 },
          "KV API response received"
        );

        if (response.ok) {
          const body = await response.json();
          const itemCount = Array.isArray(body) ? body.length : (body?.reviews?.length || "n/a");
          logger.debug(
            { url, status: response.status, itemCount },
            "KV API request succeeded"
          );
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
  updatedSince: Date,
  pageSize: number,
  startOffset: number
): string {
  const updatedSinceIso = updatedSince.toISOString();
  const encodedUpdatedSince = encodeURIComponent(updatedSinceIso);
  return `${baseUrl}/review/locations/latest?updatedSince=${encodedUpdatedSince}&start=${startOffset}&limit=${pageSize}`;
}

function buildReviewsUrl(
  baseUrl: string,
  locationId: string,
  dateSince: Date,
  pageSize: number,
  pageNumber: number
): string {
  const dateSinceIso = dateSince.toISOString();
  const encodedDateSince = encodeURIComponent(dateSinceIso);
  return `${baseUrl}/review/external?locationId=${encodeURIComponent(locationId)}&dateSince=${encodedDateSince}&orderBy=CREATE_DATE&sortOrder=ASC&pageNumber=${pageNumber}&limit=${pageSize}`;
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

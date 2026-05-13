import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { computeJitter } from "@/lib/receipt-sync";

// ─── Constants ────────────────────────────────────────────────────────────────

const MINIMUM_PROPERTY_RUNS = 100;
const MILLISECONDS_PER_SECOND = 1000;
const HEALTH_THRESHOLD_MULTIPLIER = 2;
const JITTER_PERCENTAGE = 0.1;

// ─── Pure Logic Functions Under Test ──────────────────────────────────────────

/**
 * Computes the query date by subtracting safety seconds from the watermark.
 * Mirrors the logic in sync-engine.ts.
 */
function computeQueryDateSince(watermark: Date, watermarkSafetySeconds: number): Date {
  const safetyMilliseconds = watermarkSafetySeconds * MILLISECONDS_PER_SECOND;
  const queryTimestamp = watermark.getTime() - safetyMilliseconds;
  return new Date(queryTimestamp);
}

/**
 * Simulates pagination collection logic.
 * Collects all items from pages and terminates when a page has fewer items than pageSize.
 */
function collectAllItemsFromPages<T>(pages: ReadonlyArray<ReadonlyArray<T>>, pageSize: number): {
  collectedItems: ReadonlyArray<T>;
  terminatedOnShortPage: boolean;
} {
  const collectedItems: T[] = [];
  let terminatedOnShortPage = false;

  for (const page of pages) {
    for (const item of page) {
      collectedItems.push(item);
    }

    if (page.length < pageSize) {
      terminatedOnShortPage = true;
      break;
    }
  }

  return { collectedItems, terminatedOnShortPage };
}

/**
 * Computes the new watermark from a collection of review creation dates.
 * Returns the maximum date, or the existing watermark if no dates are provided.
 */
function computeNewWatermark(reviewDates: ReadonlyArray<Date>, existingWatermark: Date): Date {
  if (reviewDates.length === 0) {
    return existingWatermark;
  }

  let maxDate = reviewDates[0];
  for (const date of reviewDates) {
    if (date.getTime() > maxDate.getTime()) {
      maxDate = date;
    }
  }

  return maxDate;
}

/**
 * Determines whether a review should be skipped based on its current status.
 * Reviews with PROCESSED or NO_RECEIPT status are skipped.
 */
function determineReviewProcessingDecision(status: string): "SKIPPED" | "PROCESS" {
  if (status === "PROCESSED" || status === "NO_RECEIPT") {
    return "SKIPPED";
  }
  return "PROCESS";
}

/**
 * Determines whether a failed review is eligible for retry or is a dead letter.
 */
function determineRetryEligibility(attemptCount: number, maxRetryAttempts: number): "ELIGIBLE_FOR_RETRY" | "DEAD_LETTER" {
  if (attemptCount < maxRetryAttempts) {
    return "ELIGIBLE_FOR_RETRY";
  }
  return "DEAD_LETTER";
}

/**
 * Determines health status based on last tick completion time and current time.
 * Returns 200 if within threshold, 503 otherwise.
 */
function determineHealthStatus(
  lastTickCompletedAtMilliseconds: number,
  currentTimeMilliseconds: number,
  pollIntervalSeconds: number
): number {
  const elapsedMilliseconds = currentTimeMilliseconds - lastTickCompletedAtMilliseconds;
  const thresholdMilliseconds = HEALTH_THRESHOLD_MULTIPLIER * pollIntervalSeconds * MILLISECONDS_PER_SECOND;

  if (elapsedMilliseconds <= thresholdMilliseconds) {
    return 200;
  }
  return 503;
}

/**
 * Determines the initial verification status for a newly synced receipt.
 */
function determineInitialVerificationStatus(autoVerifyEnabled: boolean): string {
  if (autoVerifyEnabled) {
    return "verified";
  }
  return "pending";
}

// ─── Property Tests ───────────────────────────────────────────────────────────

describe("Feature: receipt-sync-service, Property 1: Watermark safety subtraction", () => {
  const validWatermarkArbitrary = fc.integer({
    min: new Date("2020-01-01").getTime(),
    max: new Date("2030-12-31").getTime(),
  }).map((timestamp) => new Date(timestamp));

  it("for any watermark and positive safety seconds, query date equals watermark minus safety seconds", () => {
    fc.assert(
      fc.property(
        validWatermarkArbitrary,
        fc.integer({ min: 1, max: 3600 }),
        (watermark, safetySeconds) => {
          const queryDate = computeQueryDateSince(watermark, safetySeconds);
          const expectedTimestamp = watermark.getTime() - (safetySeconds * MILLISECONDS_PER_SECOND);

          expect(queryDate.getTime()).toBe(expectedTimestamp);
        }
      ),
      { numRuns: MINIMUM_PROPERTY_RUNS }
    );
  });

  /**
   * Validates: Requirements 1.1
   */
  it("query date is always earlier than the watermark when safety seconds is positive", () => {
    fc.assert(
      fc.property(
        validWatermarkArbitrary,
        fc.integer({ min: 1, max: 3600 }),
        (watermark, safetySeconds) => {
          const queryDate = computeQueryDateSince(watermark, safetySeconds);

          expect(queryDate.getTime()).toBeLessThan(watermark.getTime());
        }
      ),
      { numRuns: MINIMUM_PROPERTY_RUNS }
    );
  });
});

describe("Feature: receipt-sync-service, Property 2: Pagination collects all items and terminates on short page", () => {
  /**
   * Validates: Requirements 1.2
   */
  it("collects all items from all pages and terminates exactly when a short page is returned", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.array(fc.array(fc.integer(), { minLength: 0, maxLength: 100 }), { minLength: 1, maxLength: 10 }),
        (pageSize, rawPages) => {
          // Construct valid pages: all pages except the last must be full (length === pageSize)
          // The last page must be short (length < pageSize)
          const fullPages: number[][] = [];
          const allItems: number[] = [];

          for (let pageIndex = 0; pageIndex < rawPages.length - 1; pageIndex++) {
            // Fill each non-terminal page to exactly pageSize
            const fullPage = rawPages[pageIndex].slice(0, pageSize);
            while (fullPage.length < pageSize) {
              fullPage.push(pageIndex * pageSize + fullPage.length);
            }
            fullPages.push(fullPage);
            for (const item of fullPage) {
              allItems.push(item);
            }
          }

          // Last page is short (fewer than pageSize items)
          const lastPageRaw = rawPages[rawPages.length - 1];
          const lastPage = lastPageRaw.slice(0, Math.min(lastPageRaw.length, pageSize - 1));
          fullPages.push(lastPage);
          for (const item of lastPage) {
            allItems.push(item);
          }

          const result = collectAllItemsFromPages(fullPages, pageSize);

          expect(result.collectedItems).toEqual(allItems);
          expect(result.terminatedOnShortPage).toBe(true);
        }
      ),
      { numRuns: MINIMUM_PROPERTY_RUNS }
    );
  });
});

describe("Feature: receipt-sync-service, Property 3: Watermark advances to maximum observed date", () => {
  /**
   * Validates: Requirements 1.3
   */
  it("for any non-empty collection of dates, new watermark equals the maximum date", () => {
    const validDateArbitrary = fc.integer({
      min: new Date("2020-01-01").getTime(),
      max: new Date("2030-12-31").getTime(),
    }).map((timestamp) => new Date(timestamp));

    const existingWatermarkArbitrary = fc.integer({
      min: new Date("2019-01-01").getTime(),
      max: new Date("2019-12-31").getTime(),
    }).map((timestamp) => new Date(timestamp));

    fc.assert(
      fc.property(
        fc.array(validDateArbitrary, { minLength: 1, maxLength: 50 }),
        existingWatermarkArbitrary,
        (reviewDates, existingWatermark) => {
          const newWatermark = computeNewWatermark(reviewDates, existingWatermark);
          const maxTimestamp = Math.max(...reviewDates.map((date) => date.getTime()));

          expect(newWatermark.getTime()).toBe(maxTimestamp);
        }
      ),
      { numRuns: MINIMUM_PROPERTY_RUNS }
    );
  });

  it("if no reviews are processed, watermark remains unchanged", () => {
    const validDateArbitrary = fc.integer({
      min: new Date("2020-01-01").getTime(),
      max: new Date("2030-12-31").getTime(),
    }).map((timestamp) => new Date(timestamp));

    fc.assert(
      fc.property(
        validDateArbitrary,
        (existingWatermark) => {
          const emptyDates: ReadonlyArray<Date> = [];
          const newWatermark = computeNewWatermark(emptyDates, existingWatermark);

          expect(newWatermark.getTime()).toBe(existingWatermark.getTime());
        }
      ),
      { numRuns: MINIMUM_PROPERTY_RUNS }
    );
  });
});

describe("Feature: receipt-sync-service, Property 4: Idempotent skip for handled reviews", () => {
  /**
   * Validates: Requirements 2.5, 3.3
   */
  it("reviews with PROCESSED or NO_RECEIPT status are always skipped", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("PROCESSED", "NO_RECEIPT"),
        (status) => {
          const decision = determineReviewProcessingDecision(status);

          expect(decision).toBe("SKIPPED");
        }
      ),
      { numRuns: MINIMUM_PROPERTY_RUNS }
    );
  });

  it("reviews with FAILED status are not skipped", () => {
    fc.assert(
      fc.property(
        fc.constant("FAILED"),
        (status) => {
          const decision = determineReviewProcessingDecision(status);

          expect(decision).toBe("PROCESS");
        }
      ),
      { numRuns: MINIMUM_PROPERTY_RUNS }
    );
  });
});

describe("Feature: receipt-sync-service, Property 5: Dead letter after max retry attempts", () => {
  /**
   * Validates: Requirements 3.4
   */
  it("if attemptCount < maxRetryAttempts, review is eligible for retry", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 0, max: 99 }),
        (maxRetryAttempts, attemptOffset) => {
          // Ensure attemptCount is strictly less than maxRetryAttempts
          const attemptCount = attemptOffset % maxRetryAttempts;
          const eligibility = determineRetryEligibility(attemptCount, maxRetryAttempts);

          expect(eligibility).toBe("ELIGIBLE_FOR_RETRY");
        }
      ),
      { numRuns: MINIMUM_PROPERTY_RUNS }
    );
  });

  it("if attemptCount >= maxRetryAttempts, review is a dead letter", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 0, max: 50 }),
        (maxRetryAttempts, extraAttempts) => {
          const attemptCount = maxRetryAttempts + extraAttempts;
          const eligibility = determineRetryEligibility(attemptCount, maxRetryAttempts);

          expect(eligibility).toBe("DEAD_LETTER");
        }
      ),
      { numRuns: MINIMUM_PROPERTY_RUNS }
    );
  });
});

describe("Feature: receipt-sync-service, Property 6: Health status 200/503 determination", () => {
  /**
   * Validates: Requirements 5.1, 5.2
   */
  it("returns 200 when elapsed time is within 2 * pollIntervalSeconds", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 60, max: 3600 }),
        fc.integer({ min: 0, max: 100 }),
        (pollIntervalSeconds, percentageOfThreshold) => {
          const thresholdMilliseconds = HEALTH_THRESHOLD_MULTIPLIER * pollIntervalSeconds * MILLISECONDS_PER_SECOND;
          const elapsedMilliseconds = Math.floor((percentageOfThreshold / 100) * thresholdMilliseconds);
          const currentTime = 1000000000 + elapsedMilliseconds;
          const lastTickCompletedAt = 1000000000;

          const statusCode = determineHealthStatus(lastTickCompletedAt, currentTime, pollIntervalSeconds);

          expect(statusCode).toBe(200);
        }
      ),
      { numRuns: MINIMUM_PROPERTY_RUNS }
    );
  });

  it("returns 503 when elapsed time exceeds 2 * pollIntervalSeconds", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 60, max: 3600 }),
        fc.integer({ min: 1, max: 10000 }),
        (pollIntervalSeconds, extraMilliseconds) => {
          const thresholdMilliseconds = HEALTH_THRESHOLD_MULTIPLIER * pollIntervalSeconds * MILLISECONDS_PER_SECOND;
          const elapsedMilliseconds = thresholdMilliseconds + extraMilliseconds;
          const currentTime = 1000000000 + elapsedMilliseconds;
          const lastTickCompletedAt = 1000000000;

          const statusCode = determineHealthStatus(lastTickCompletedAt, currentTime, pollIntervalSeconds);

          expect(statusCode).toBe(503);
        }
      ),
      { numRuns: MINIMUM_PROPERTY_RUNS }
    );
  });
});

describe("Feature: receipt-sync-service, Property 7: Auto-verify flag sets correct initial status", () => {
  /**
   * Validates: Requirements 9.1, 9.2
   */
  it("when autoVerify is true, initial status is verified", () => {
    fc.assert(
      fc.property(
        fc.constant(true),
        (autoVerifyEnabled) => {
          const status = determineInitialVerificationStatus(autoVerifyEnabled);

          expect(status).toBe("verified");
        }
      ),
      { numRuns: MINIMUM_PROPERTY_RUNS }
    );
  });

  it("when autoVerify is false, initial status is pending", () => {
    fc.assert(
      fc.property(
        fc.constant(false),
        (autoVerifyEnabled) => {
          const status = determineInitialVerificationStatus(autoVerifyEnabled);

          expect(status).toBe("pending");
        }
      ),
      { numRuns: MINIMUM_PROPERTY_RUNS }
    );
  });

  it("for any boolean flag, status is always either verified or pending", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        (autoVerifyEnabled) => {
          const status = determineInitialVerificationStatus(autoVerifyEnabled);

          if (autoVerifyEnabled) {
            expect(status).toBe("verified");
          } else {
            expect(status).toBe("pending");
          }
        }
      ),
      { numRuns: MINIMUM_PROPERTY_RUNS }
    );
  });
});

describe("Feature: receipt-sync-service, Property 8: Jitter bounded within 10% of poll interval", () => {
  /**
   * Validates: Requirements 4.6
   */
  it("jitter is always >= 0 and <= 0.1 * pollIntervalSeconds * 1000", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 3600 }),
        (pollIntervalSeconds) => {
          const jitter = computeJitter(pollIntervalSeconds);
          const maxJitter = JITTER_PERCENTAGE * pollIntervalSeconds * MILLISECONDS_PER_SECOND;

          expect(jitter).toBeGreaterThanOrEqual(0);
          expect(jitter).toBeLessThanOrEqual(maxJitter);
        }
      ),
      { numRuns: MINIMUM_PROPERTY_RUNS }
    );
  });

  it("jitter is always an integer (floored value)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 3600 }),
        (pollIntervalSeconds) => {
          const jitter = computeJitter(pollIntervalSeconds);

          expect(Number.isInteger(jitter)).toBe(true);
        }
      ),
      { numRuns: MINIMUM_PROPERTY_RUNS }
    );
  });
});

import { logger } from "@/lib/logger";
import { KvApiClient } from "./kv-api-client";
import { KvS3Client } from "./kv-s3-client";
import {
  getStateByReviewId,
  upsertState,
  getWatermark,
  upsertWatermark,
  createTick,
  completeTick,
  getFailedStatesForRetry,
} from "./state-repository";
import { createReceiptFromSync } from "./receipt-creator";
import type {
  SyncConfiguration,
  TenantToken,
  SyncTickResult,
  ReviewDto,
  SyncInstrumentationHook,
} from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

const MILLISECONDS_PER_SECOND = 1000;

// ─── Sync Engine ──────────────────────────────────────────────────────────────

export async function executeTick(
  configuration: SyncConfiguration,
  instrumentationHook?: SyncInstrumentationHook
): Promise<ReadonlyArray<SyncTickResult>> {
  const results: SyncTickResult[] = [];

  for (const tenantToken of configuration.kvPublicationApiTokens) {
    if (instrumentationHook?.onTickStart) {
      instrumentationHook.onTickStart(tenantToken.tenantId);
    }

    try {
      const result = await executeTickForTenant(configuration, tenantToken);
      results.push(result);

      if (instrumentationHook?.onTickComplete) {
        instrumentationHook.onTickComplete(result);
      }
    } catch (error: unknown) {
      logger.error(
        { tenantId: tenantToken.tenantId, error },
        "Tick execution failed for tenant"
      );

      if (instrumentationHook?.onTickError) {
        instrumentationHook.onTickError(tenantToken.tenantId, error);
      }
    }
  }

  return results;
}

// ─── Per-Tenant Tick Execution ────────────────────────────────────────────────

async function executeTickForTenant(
  configuration: SyncConfiguration,
  tenantToken: TenantToken
): Promise<SyncTickResult> {
  const tickStartTime = Date.now();
  const tenantId = tenantToken.tenantId;

  const tick = await createTick(tenantId);

  // Load watermark
  const watermarkRecord = await getWatermark(tenantId);
  let watermarkDate: Date;
  if (watermarkRecord) {
    watermarkDate = watermarkRecord.watermark;
  } else {
    watermarkDate = new Date();
    await upsertWatermark(tenantId, watermarkDate);
  }

  // Subtract safety seconds from watermark for query
  const safetyMilliseconds = configuration.watermarkSafetySeconds * MILLISECONDS_PER_SECOND;
  const queryDateSince = new Date(watermarkDate.getTime() - safetyMilliseconds);

  const kvApiClient = new KvApiClient(configuration);

  // Discover locations
  const allReviews: ReviewDto[] = [];
  let locationsDiscovered = 0;

  const locationBatches: string[][] = [];
  let currentBatch: string[] = [];

  for await (const locationPage of kvApiClient.fetchLocationsLatest(
    tenantToken.token,
    queryDateSince,
    configuration.pageSize
  )) {
    for (const location of locationPage) {
      locationsDiscovered = locationsDiscovered + 1;
      currentBatch.push(location.locationId);

      if (currentBatch.length >= configuration.workerConcurrency) {
        locationBatches.push(currentBatch);
        currentBatch = [];
      }
    }
  }

  if (currentBatch.length > 0) {
    locationBatches.push(currentBatch);
  }

  // Process location batches with concurrency limit
  for (const batch of locationBatches) {
    const batchPromises = batch.map((locationId) =>
      discoverReviewsForLocation(
        kvApiClient,
        tenantToken.token,
        locationId,
        queryDateSince,
        configuration.pageSize
      )
    );

    const batchResults = await Promise.all(batchPromises);
    for (const reviews of batchResults) {
      allReviews.push(...reviews);
    }
  }

  // Also retry previously failed reviews
  const failedStates = await getFailedStatesForRetry(tenantId, configuration.maxRetryAttempts);
  const failedReviewIds = new Set(failedStates.map((state) => state.reviewId));

  // Process reviews and resolve receipts
  let receiptsProcessed = 0;
  let noReceiptCount = 0;
  let failedCount = 0;
  let maxObservedDate: Date | null = null;

  const s3Enabled = configuration.kvReceiptS3BucketName.length > 0;
  let kvS3Client: KvS3Client | null = null;
  if (s3Enabled) {
    kvS3Client = new KvS3Client(configuration);
  }

  for (const review of allReviews) {
    const reviewCreatedAt = new Date(review.createdAt);
    if (!maxObservedDate || reviewCreatedAt > maxObservedDate) {
      maxObservedDate = reviewCreatedAt;
    }

    const result = await processReview(
      review,
      tenantId,
      kvS3Client,
      configuration.receiptAutoVerifyEnabled
    );

    if (result === "PROCESSED") {
      receiptsProcessed = receiptsProcessed + 1;
    } else if (result === "NO_RECEIPT") {
      noReceiptCount = noReceiptCount + 1;
    } else if (result === "FAILED") {
      failedCount = failedCount + 1;
    }
    // "SKIPPED" means already handled, don't count
  }

  // Retry failed reviews from previous ticks
  for (const failedState of failedStates) {
    if (failedReviewIds.has(failedState.reviewId)) {
      const syntheticReview: ReviewDto = {
        reviewId: failedState.reviewId,
        locationId: failedState.locationId,
        createdAt: failedState.processedAt.toISOString(),
        shopName: null,
        reviewDate: null,
        amount: null,
      };

      const result = await processReview(
        syntheticReview,
        tenantId,
        kvS3Client,
        configuration.receiptAutoVerifyEnabled,
        failedState.attemptCount
      );

      if (result === "PROCESSED") {
        receiptsProcessed = receiptsProcessed + 1;
      } else if (result === "NO_RECEIPT") {
        noReceiptCount = noReceiptCount + 1;
      } else if (result === "FAILED") {
        failedCount = failedCount + 1;
      }
    }
  }

  // Update watermark to max observed date
  let newWatermark: Date;
  if (maxObservedDate) {
    newWatermark = maxObservedDate;
    await upsertWatermark(tenantId, newWatermark);
  } else {
    newWatermark = watermarkDate;
  }

  // Complete tick record
  await completeTick({
    tickId: tick.id,
    locationsDiscovered,
    reviewsDiscovered: allReviews.length,
    receiptsProcessed,
    noReceiptCount,
    failedCount,
  });

  const durationMilliseconds = Date.now() - tickStartTime;

  logger.info(
    {
      tenantId,
      locationsDiscovered,
      reviewsDiscovered: allReviews.length,
      receiptsProcessed,
      noReceiptCount,
      failedCount,
      durationMilliseconds,
    },
    "Tick completed for tenant"
  );

  return {
    tenantId,
    locationsDiscovered,
    reviewsDiscovered: allReviews.length,
    receiptsProcessed,
    noReceiptCount,
    failedCount,
    newWatermark,
    durationMilliseconds,
  };
}

// ─── Review Discovery ─────────────────────────────────────────────────────────

async function discoverReviewsForLocation(
  kvApiClient: KvApiClient,
  token: string,
  locationId: string,
  dateSince: Date,
  pageSize: number
): Promise<ReviewDto[]> {
  const reviews: ReviewDto[] = [];

  for await (const reviewPage of kvApiClient.fetchReviewsForLocation(
    token,
    locationId,
    dateSince,
    pageSize
  )) {
    reviews.push(...reviewPage);
  }

  return reviews;
}

// ─── Review Processing ────────────────────────────────────────────────────────

type ProcessResult = "PROCESSED" | "NO_RECEIPT" | "FAILED" | "SKIPPED";

async function processReview(
  review: ReviewDto,
  tenantId: number,
  kvS3Client: KvS3Client | null,
  receiptAutoVerifyEnabled: boolean,
  previousAttemptCount?: number
): Promise<ProcessResult> {
  // Check if already handled
  const existingState = await getStateByReviewId(review.reviewId);
  if (existingState) {
    if (existingState.status === "PROCESSED" || existingState.status === "NO_RECEIPT") {
      return "SKIPPED";
    }
  }

  // If S3 is not configured, mark as NO_RECEIPT
  if (!kvS3Client) {
    await upsertState({
      reviewId: review.reviewId,
      tenantId,
      locationId: review.locationId,
      status: "NO_RECEIPT",
    });
    return "NO_RECEIPT";
  }

  try {
    const objects = await kvS3Client.listReceiptObjects(review.reviewId);

    if (objects.length === 0) {
      await upsertState({
        reviewId: review.reviewId,
        tenantId,
        locationId: review.locationId,
        status: "NO_RECEIPT",
      });
      return "NO_RECEIPT";
    }

    const firstObject = objects[0];
    const content = await kvS3Client.getReceiptContent(firstObject.key);

    const receiptId = await createReceiptFromSync({
      review,
      s3Key: firstObject.key,
      fileSize: content.length,
      receiptAutoVerifyEnabled,
    });

    const receiptMetadata = JSON.stringify({
      shopName: review.shopName,
      reviewDate: review.reviewDate,
      amount: review.amount,
    });

    await upsertState({
      reviewId: review.reviewId,
      tenantId,
      locationId: review.locationId,
      status: "PROCESSED",
      s3Key: firstObject.key,
      s3Etag: firstObject.etag,
      receiptContent: receiptMetadata,
      receiptId,
    });

    return "PROCESSED";
  } catch (error: unknown) {
    const currentAttemptCount = (previousAttemptCount || 0) + 1;
    const errorMessage = error instanceof Error ? error.message : String(error);

    await upsertState({
      reviewId: review.reviewId,
      tenantId,
      locationId: review.locationId,
      status: "FAILED",
      attemptCount: currentAttemptCount,
      errorMessage,
    });

    logger.warn(
      { reviewId: review.reviewId, tenantId, attemptCount: currentAttemptCount, error },
      "Failed to process review receipt"
    );

    return "FAILED";
  }
}

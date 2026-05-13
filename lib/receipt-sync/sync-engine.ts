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
import { prisma } from "@/lib/db";
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
  const queryUpdatedSince = new Date(watermarkDate.getTime() - safetyMilliseconds);

  const kvApiClient = new KvApiClient(configuration);

  // Check which locations were already processed in a previous (interrupted) run
  const processedLocationIds = await getProcessedLocationIdsForTick(tick.id);

  const s3Enabled = configuration.kvReceiptS3BucketName.length > 0;
  let kvS3Client: KvS3Client | null = null;
  if (s3Enabled) {
    kvS3Client = new KvS3Client(configuration);
  }

  let locationsDiscovered = 0;
  let totalReviewsDiscovered = 0;
  let receiptsProcessed = 0;
  let noReceiptCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let maxObservedDate: Date | null = null;
  let locationIndex = 0;

  // ─── Stream location pages: discover batch → process batch → next batch ─────

  for await (const locationPage of kvApiClient.fetchLocationsLatest(
    tenantToken.token,
    queryUpdatedSince,
    configuration.pageSize
  )) {
    locationsDiscovered = locationsDiscovered + locationPage.length;

    logger.info(
      { tenantId, batchSize: locationPage.length, locationsDiscoveredSoFar: locationsDiscovered },
      "Location batch received, processing immediately"
    );

    for (const location of locationPage) {
      locationIndex = locationIndex + 1;

      // Skip locations already processed in a previous interrupted run
      if (processedLocationIds.has(location.locationId)) {
        logger.info(
          { tenantId, locationId: location.locationId, locationName: location.locationName, locationIndex },
          "Skipping already-processed location (resuming)"
        );
        continue;
      }

      logger.info(
        { tenantId, locationId: location.locationId, locationName: location.locationName, locationIndex },
        "Processing location"
      );

      // Fetch reviews for this location
      const locationReviews: ReviewDto[] = [];

      for await (const reviewPage of kvApiClient.fetchReviewsForLocation(
        tenantToken.token,
        location.locationId,
        queryUpdatedSince,
        configuration.pageSize
      )) {
        locationReviews.push(...reviewPage);
      }

      totalReviewsDiscovered = totalReviewsDiscovered + locationReviews.length;

      // Process each review immediately
      for (const review of locationReviews) {
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
        } else {
          skippedCount = skippedCount + 1;
        }
      }

      // Mark this location as processed for resumability
      await markLocationProcessedForTick(tick.id, location.locationId);

      logger.info(
        {
          tenantId,
          locationId: location.locationId,
          locationName: location.locationName,
          reviewsInLocation: locationReviews.length,
          locationIndex,
          receiptsProcessed,
          noReceiptCount,
          failedCount,
          skippedCount,
        },
        "Location processing complete"
      );
    }
  }

  // ─── Retry previously failed reviews ───────────────────────────────────────

  const failedStates = await getFailedStatesForRetry(tenantId, configuration.maxRetryAttempts);

  if (failedStates.length > 0) {
    logger.info(
      { tenantId, failedRetries: failedStates.length },
      "Retrying previously failed reviews"
    );

    for (const failedState of failedStates) {
      const syntheticReview: ReviewDto = {
        reviewId: failedState.reviewId,
        locationId: failedState.locationId,
        createdAt: failedState.processedAt.toISOString(),
        reviewAuthor: null,
        rating: null,
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

  // ─── Finalize ──────────────────────────────────────────────────────────────

  let newWatermark: Date;
  if (maxObservedDate) {
    newWatermark = maxObservedDate;
    await upsertWatermark(tenantId, newWatermark);
  } else {
    newWatermark = watermarkDate;
  }

  await completeTick({
    tickId: tick.id,
    locationsDiscovered,
    reviewsDiscovered: totalReviewsDiscovered,
    receiptsProcessed,
    noReceiptCount,
    failedCount,
  });

  const durationMilliseconds = Date.now() - tickStartTime;

  logger.info(
    {
      tenantId,
      locationsDiscovered,
      reviewsDiscovered: totalReviewsDiscovered,
      receiptsProcessed,
      noReceiptCount,
      failedCount,
      skippedCount,
      durationMilliseconds,
    },
    "Tick completed for tenant"
  );

  return {
    tenantId,
    locationsDiscovered,
    reviewsDiscovered: totalReviewsDiscovered,
    receiptsProcessed,
    noReceiptCount,
    failedCount,
    newWatermark,
    durationMilliseconds,
  };
}

// ─── Location Progress Tracking ───────────────────────────────────────────────

async function getProcessedLocationIdsForTick(tickId: string): Promise<Set<string>> {
  const markerPrefix = `tick-progress:${tickId}:`;

  const records = await prisma.receiptSyncState.findMany({
    where: {
      reviewId: { startsWith: markerPrefix },
    },
    select: { locationId: true },
  });

  return new Set(records.map((record) => record.locationId));
}

async function markLocationProcessedForTick(tickId: string, locationId: string): Promise<void> {
  const markerId = `tick-progress:${tickId}:${locationId}`;

  await prisma.receiptSyncState.upsert({
    where: { reviewId: markerId },
    create: {
      reviewId: markerId,
      tenantId: 0,
      locationId: locationId,
      status: "PROCESSED",
      processedAt: new Date(),
      receiptContent: JSON.stringify({ tickId, locationId, type: "location-progress-marker" }),
    },
    update: {
      processedAt: new Date(),
    },
  });
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
  const existingState = await getStateByReviewId(review.reviewId);
  if (existingState) {
    if (existingState.status === "PROCESSED" || existingState.status === "NO_RECEIPT") {
      return "SKIPPED";
    }
  }

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
      reviewAuthor: review.reviewAuthor,
      rating: review.rating,
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

    logger.info(
      { reviewId: review.reviewId, locationId: review.locationId, s3Key: firstObject.key },
      "Receipt processed successfully"
    );

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

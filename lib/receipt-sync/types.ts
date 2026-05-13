// ─── Sync Configuration ───────────────────────────────────────────────────────

export interface TenantToken {
  readonly tenantId: number;
  readonly token: string;
}

export interface SyncConfiguration {
  readonly kvApiBaseUrl: string;
  readonly kvPublicationApiTokens: ReadonlyArray<TenantToken>;
  readonly kvReceiptS3BucketName: string;
  readonly kvReceiptAwsRegion: string;
  readonly pollIntervalSeconds: number;
  readonly watermarkSafetySeconds: number;
  readonly pageSize: number;
  readonly workerConcurrency: number;
  readonly apiRateLimitSeconds: number;
  readonly receiptAutoVerifyEnabled: boolean;
  readonly maxRetryAttempts: number;
}

// ─── Sync Tick Result ─────────────────────────────────────────────────────────

export interface SyncTickResult {
  readonly tenantId: number;
  readonly locationsDiscovered: number;
  readonly reviewsDiscovered: number;
  readonly receiptsProcessed: number;
  readonly noReceiptCount: number;
  readonly failedCount: number;
  readonly newWatermark: Date;
  readonly durationMilliseconds: number;
}

// ─── Review Sync Status ───────────────────────────────────────────────────────

export type ReviewSyncStatus = "PROCESSED" | "NO_RECEIPT" | "FAILED";

// ─── KV API DTOs ──────────────────────────────────────────────────────────────

export interface LocationDto {
  readonly locationId: string;
  readonly name: string;
}

export interface ReviewDto {
  readonly reviewId: string;
  readonly locationId: string;
  readonly createdAt: string;
  readonly shopName: string | null;
  readonly reviewDate: string | null;
  readonly amount: number | null;
}

// ─── S3 Object Info ───────────────────────────────────────────────────────────

export interface S3ObjectInfo {
  readonly key: string;
  readonly etag: string;
  readonly size: number;
}

// ─── Instrumentation Hook ─────────────────────────────────────────────────────

export interface SyncInstrumentationHook {
  readonly onTickStart?: (tenantId: number) => void;
  readonly onTickComplete?: (result: SyncTickResult) => void;
  readonly onTickError?: (tenantId: number, error: unknown) => void;
}

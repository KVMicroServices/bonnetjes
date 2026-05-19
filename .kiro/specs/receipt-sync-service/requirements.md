# Requirements Document

## Introduction

A background sync service that incrementally discovers and fetches review receipts from the KV platform's S3 bucket into the local system. The service polls the KV API for recently updated locations and reviews, resolves receipt files from S3 by prefix listing, and persists them locally. It integrates into the existing Next.js app as API routes and a Prisma-backed state store, with synced reviews displayed in the admin reviews list and a manual verification workflow.

## Glossary

- **Sync_Service**: The background polling process that discovers reviews and fetches receipts from the KV platform
- **KV_API**: The KlantenVertellen publication API used to discover locations and reviews
- **Receipt_Store**: The Prisma-backed PostgreSQL tables tracking sync state per review
- **Watermark**: A per-tenant timestamp recording the last successfully synced point in time
- **Tick**: A single execution cycle of the sync loop
- **Location**: A business location registered on the KV platform that may have associated reviews
- **Review**: A customer review record on the KV platform, identified by a UUID reviewId
- **Receipt**: An uploaded file (image or PDF) in S3 associated with a review, keyed as `<reviewId>.<extension>`
- **Backfill_Command**: A manually triggered operation that sets the watermark to 30 days ago and runs a full sync cycle
- **Health_Endpoint**: An API route reporting whether the service is operating within expected timing bounds
- **Verification_Action**: An admin action to manually approve or reject a synced receipt

## Requirements

### Requirement 1: Incremental Review Discovery

**User Story:** As an operator, I want the service to discover new reviews incrementally using a persisted watermark, so that every receipt is eventually processed without redundant full scans.

#### Acceptance Criteria

1. WHEN a tick begins, THE Sync_Service SHALL load the watermark for each configured tenant from the Receipt_Store and subtract WATERMARK_SAFETY_SECONDS before querying the KV_API
2. WHEN the KV_API returns locations from the locations/latest endpoint, THE Sync_Service SHALL paginate through all results using the configured PAGE_SIZE until a short page is returned
3. WHEN all reviews for a tick have been processed, THE Sync_Service SHALL persist the maximum observed review creation date as the new watermark for that tenant
4. WHILE no watermark exists for a tenant, THE Sync_Service SHALL use the current timestamp as the initial watermark (backfill requires explicit manual trigger)
5. THE Sync_Service SHALL filter reviews using the dateSince parameter (creation date), not updatedSince, to avoid resurfacing old reviews on edits

### Requirement 2: Receipt Resolution from S3

**User Story:** As an operator, I want the service to resolve receipt files from S3 using prefix listing, so that receipts with unknown file extensions are correctly discovered.

#### Acceptance Criteria

1. WHEN a review has not been previously handled, THE Sync_Service SHALL call S3 ListObjectsV2 with prefix set to `<reviewId>.` and maxKeys set to 2
2. WHEN the S3 listing returns zero objects, THE Sync_Service SHALL mark the review as NO_RECEIPT in the Receipt_Store
3. WHEN the S3 listing returns one or more objects, THE Sync_Service SHALL fetch the first object using GetObject and store the receipt content along with the S3 key and ETag
4. IF the S3 GetObject call fails with a retryable error (5xx, throttling, timeout), THEN THE Sync_Service SHALL mark the review as FAILED with an incremented attempt counter and retry on the next tick
5. IF a review is already marked as handled (PROCESSED or NO_RECEIPT) in the Receipt_Store, THEN THE Sync_Service SHALL skip that review without making any S3 or API calls

### Requirement 3: Idempotent State Tracking

**User Story:** As an operator, I want the service to track processing state per review in a persistent store, so that restarts and overlapping queries do not cause reprocessing.

#### Acceptance Criteria

1. THE Receipt_Store SHALL maintain a record per review containing: review_id, tenant_id, location_id, status (PROCESSED, NO_RECEIPT, FAILED), s3_key, s3_etag, attempt_count, processed_at, and error_message
2. THE Receipt_Store SHALL maintain a watermark record per tenant containing: tenant_id and watermark timestamp
3. WHEN a review is marked as PROCESSED or NO_RECEIPT, THE Sync_Service SHALL treat that review as permanently handled and never re-check it
4. WHEN a review is marked as FAILED, THE Sync_Service SHALL retry it on subsequent ticks until the attempt count exceeds a configured maximum, after which the review is treated as a dead letter

### Requirement 4: Operational Resilience

**User Story:** As an operator, I want the service to handle transient failures, rate limits, and clock skew gracefully, so that it remains reliable without manual intervention.

#### Acceptance Criteria

1. THE Sync_Service SHALL limit concurrent location processing to WORKER_CONCURRENCY parallel workers
2. THE Sync_Service SHALL rate-limit outbound KV_API requests to a maximum of one request per API_RATE_LIMIT seconds (aggregate across all workers)
3. WHEN the KV_API returns a 5xx status or a network timeout, THE Sync_Service SHALL retry with exponential backoff up to 3 attempts before marking the tick as partially failed
4. WHEN the KV_API returns a 4xx status (except 429), THE Sync_Service SHALL not retry and SHALL log the error
5. WHEN the KV_API returns 429 with a Retry-After header, THE Sync_Service SHALL wait the specified duration before retrying
6. THE Sync_Service SHALL add random jitter (up to 10% of POLL_INTERVAL_SECONDS) to each tick start to avoid thundering-herd alignment

### Requirement 5: Health Monitoring

**User Story:** As an operator, I want a health endpoint that reports whether the sync service is operating normally, so that monitoring systems can alert on failures.

#### Acceptance Criteria

1. THE Health_Endpoint SHALL return HTTP 200 when the last successful tick completed within 2 times POLL_INTERVAL_SECONDS ago
2. THE Health_Endpoint SHALL return HTTP 503 when the last successful tick is older than 2 times POLL_INTERVAL_SECONDS or no tick has ever completed
3. THE Health_Endpoint SHALL include the last tick timestamp and watermark age in the response body

### Requirement 6: Manual Backfill Command

**User Story:** As an operator, I want to manually trigger a backfill that looks back 30 days, so that initial data loading is an explicit controlled action rather than an automatic process.

#### Acceptance Criteria

1. WHEN the backfill command is invoked, THE Sync_Service SHALL set the watermark for the specified tenant to the current time minus 30 days
2. WHEN the backfill command is invoked, THE Sync_Service SHALL immediately execute a full sync tick for the specified tenant
3. THE Backfill_Command SHALL be exposed as an admin-only API endpoint requiring authentication
4. IF the current watermark is already within 30 days of now, THEN THE Backfill_Command SHALL warn the operator and require explicit confirmation via a force parameter

### Requirement 7: Synced Receipt Display in Admin Receipts List

**User Story:** As an admin, I want synced receipts and their OCR-extracted data (shop name, date, amount) to appear in the existing admin receipts table, so that I can review all receipt data in one place.

#### Acceptance Criteria

1. WHEN a receipt is successfully synced (status PROCESSED), THE Sync_Service SHALL store the receipt file reference and extracted metadata (shop name, date, amount) in the Receipt_Store via the receipt_content JSON field
2. THE Admin_Receipts_List SHALL display synced receipts alongside user-uploaded receipts, showing the extracted shop name, date, amount, and verification status
3. WHEN a synced receipt has a file (status PROCESSED), THE Admin_Receipts_List SHALL provide a link to download or view the receipt image/PDF

### Requirement 8: Manual Receipt Verification

**User Story:** As an admin, I want to manually verify or reject synced receipts, so that I can confirm receipt authenticity before they are considered approved.

#### Acceptance Criteria

1. THE Admin_Reviews_List SHALL display a verification button for each synced receipt with status PROCESSED
2. WHEN an admin clicks the verify button, THE Verification_Action SHALL update the receipt status to VERIFIED and record the admin ID and timestamp
3. WHEN an admin clicks the reject button, THE Verification_Action SHALL update the receipt status to REJECTED and record the admin ID, timestamp, and optional rejection reason
4. THE Verification_Action SHALL require admin authentication and authorization

### Requirement 9: Auto-Verification Toggle

**User Story:** As an operator, I want an environment variable that controls whether synced receipts are automatically verified, so that automatic verification can be enabled later without code changes.

#### Acceptance Criteria

1. WHEN RECEIPT_AUTO_VERIFY_ENABLED is set to "true", THE Sync_Service SHALL automatically mark newly synced receipts as VERIFIED upon successful processing
2. WHILE RECEIPT_AUTO_VERIFY_ENABLED is not set or set to "false", THE Sync_Service SHALL leave newly synced receipts in PENDING verification status requiring manual verification
3. THE Sync_Service SHALL read the RECEIPT_AUTO_VERIFY_ENABLED value at startup and on each tick to allow runtime configuration changes without restart

### Requirement 10: Configuration via Environment Variables

**User Story:** As an operator, I want all service parameters configurable via environment variables, so that deployment configuration is externalized from code.

#### Acceptance Criteria

1. THE Sync_Service SHALL read KV_API_BASE_URL, KV_PUBLICATION_API_TOKENS, KV_RECEIPT_S3_BUCKET_NAME, KV_RECEIPT_AWS_REGION, POLL_INTERVAL_SECONDS, WATERMARK_SAFETY_SECONDS, PAGE_SIZE, WORKER_CONCURRENCY, API_RATE_LIMIT, and RECEIPT_AUTO_VERIFY_ENABLED from environment variables
2. THE Sync_Service SHALL apply default values for: KV_RECEIPT_AWS_REGION (eu-central-1), POLL_INTERVAL_SECONDS (300), WATERMARK_SAFETY_SECONDS (60), PAGE_SIZE (200), WORKER_CONCURRENCY (4), API_RATE_LIMIT (1), RECEIPT_AUTO_VERIFY_ENABLED (false)
3. IF KV_API_BASE_URL or KV_PUBLICATION_API_TOKENS is not set, THEN THE Sync_Service SHALL log a warning and skip sync ticks until configured
4. IF KV_RECEIPT_S3_BUCKET_NAME is not set, THEN THE Sync_Service SHALL log a warning and skip receipt fetching from S3

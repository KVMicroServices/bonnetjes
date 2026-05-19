
---

# Build a Receipt Sync Service

## Goal

Build a standalone service that incrementally syncs review receipts from the KV platform's AWS S3 bucket into our system, using only existing public endpoints and S3 read access. No changes to the source platform are permitted.

The service must:
1. Process every receipt eventually.
2. Avoid reprocessing the same receipt across runs.
3. Handle reviews that exist but have no receipt in S3 (this is normal).
4. Survive restarts, transient API/S3 failures, and clock skew.
5. Stay within the 30-day server-side look-back limit on the source API.

## Background

The KV platform stores user-submitted receipts in S3 with object keys of the form `<reviewId>.<extension>`, where:
- `<reviewId>` is a UUID generated at upload time and persisted on the review record.
- `<extension>` is the original uploaded file's extension (e.g. `jpg`, `png`, `pdf`). It is **not** stored in the platform's database, so the consuming service must discover it via S3 prefix listing.

Reviews that don't go through the receipt-upload flow (legacy reviews, email-verified reviews, imported reviews) will have a `reviewId` but no S3 object. This is expected.

## Source API

Base URL: `<KV_API_BASE_URL>` (production URL, get from platform team)

Authentication: `X-Publication-Api-Token: <PUBLICATION_API_TOKEN>` header on every request. Token must have `PUBLICATION_API_PARTNER_PLUS` role. One token per tenant; tenants in scope are typically 98 and 99.

Required content negotiation: `Accept: application/json`.

### Endpoints used

**1. Discover locations with recent activity**
```
GET /v1/publication/review/locations/latest
    ?updatedSince=<ISO-8601>
    &dateSince=<ISO-8601>
    &start=<long>
    &limit=<long>
```
- All four query params are required.
- Date format: `yyyy-MM-dd'T'HH:mm:SS.sssZ`.
- Returns a paginated list of `LocationStatsUpdateDto`. Walk pages until empty or short page.
- Server-enforced max look-back from now is 30 days (configurable on the source side as `publication.review.locations.limit.days`, default 30). Watermarks older than this return `DATE_OUT_OF_RANGE` (HTTP 400).

**2. Fetch reviews per location**
```
GET /v1/publication/review/external
    ?locationId=<id>
    &dateSince=<ISO-8601>
    &orderBy=CREATE_DATE
    &sortOrder=ASC
    &pageNumber=<int>
    &limit=<int>
```
- Use `dateSince` (creation date), not `updatedSince`. Receipts are tied to creation; filtering by modification would re-surface old reviews on edits.
- Response contains `reviews[]` of `ReviewExternalDto`. The `reviewId` field is the UUID used as the S3 object key prefix.
- Paginate via `pageNumber`. Stop when a page returns fewer than `limit` results.

## S3 access

- AWS region: `eu-central-1` (Frankfurt). Hardcoded on the source side, do not change.
- Bucket: `<S3_BUCKET_NAME>` (get from platform/AWS team)
- Credentials: prefer an IAM role with `s3:ListBucket` and `s3:GetObject` on the bucket and its objects. Static keys (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`) are acceptable as a fallback. Do not embed credentials in source.
- Object key pattern: `<reviewId>.<ext>`, flat at the bucket root.
- Use AWS SDK v2 (`software.amazon.awssdk:s3`).

## Algorithm

Persist a single watermark (e.g. `lastDateSince`) in the service's own state store. On every tick:

```
loop every POLL_INTERVAL (e.g. 5 minutes):
    watermark = state.loadWatermark()                      // ISO-8601
    safeFloor = watermark - 60 seconds                     // clock-skew cushion
    maxSeen   = watermark

    for each tenantToken in configured tokens:

        // 1. Discover locations changed since the watermark
        locations = []
        start = 0
        while true:
            page = GET /v1/publication/review/locations/latest
                       ?updatedSince=safeFloor
                       &dateSince=safeFloor
                       &start=start
                       &limit=200
            locations += page
            if page.size < 200: break
            start += 200

        // 2. For each location, paginate reviews newer than watermark
        for each location in locations:
            pageNumber = 0
            while true:
                page = GET /v1/publication/review/external
                           ?locationId=<location.id>
                           &dateSince=safeFloor
                           &orderBy=CREATE_DATE
                           &sortOrder=ASC
                           &pageNumber=pageNumber
                           &limit=200

                for each review in page.reviews:
                    if state.isHandled(review.reviewId): continue

                    // 3. Resolve and fetch the S3 object
                    listing = s3.listObjectsV2(
                        bucket=<S3_BUCKET_NAME>,
                        prefix=review.reviewId + ".",
                        maxKeys=2)

                    if listing.contents.isEmpty():
                        state.markNoReceipt(review.reviewId)
                    else:
                        key   = listing.contents[0].key
                        bytes = s3.getObject(<S3_BUCKET_NAME>, key)
                        process(review, bytes, key)
                        state.markProcessed(review.reviewId, listing.contents[0].eTag)

                    maxSeen = max(maxSeen, parse(review.dateSince))

                if page.reviews.size < 200: break
                pageNumber += 1

    state.saveWatermark(maxSeen)
```

## Correctness requirements

- **Idempotency**: `state.isHandled` must short-circuit any reviewId already processed (whether it had a receipt or not). Use a persistent store (Postgres table, DynamoDB, etc.) keyed by `reviewId`. Record at minimum: `reviewId`, status (`PROCESSED` | `NO_RECEIPT` | `FAILED`), `s3ETag` (nullable), `processedAt`.
- **Watermark cushion**: subtract 60 seconds before querying. Idempotency handles overlap.
- **Field choice**: filter on `dateSince`, not `updatedSince`. Document this choice in the code.
- **Missing receipts are normal**: empty `listObjectsV2.contents` and `NoSuchKeyException` from `getObject` both mean "no receipt". Mark as `NO_RECEIPT` and never re-check.
- **Retryable vs terminal failures**: distinguish S3 throttling, timeouts, 5xx (retry with backoff) from 404/empty listing (mark `NO_RECEIPT`). Mark transient failures as `FAILED` and retry on the next tick, but with an attempt counter and dead-letter cap.
- **Backfill on first run**: on cold start, set the watermark to `now - 30 days` (the look-back limit). Anything older than 30 days is unreachable through this API and must be backfilled out of band if needed.

## Operational requirements

- **Concurrency**: process locations concurrently with a bounded worker pool (e.g. 4–8 workers). Do not fire all location requests in one burst.
- **Rate limiting**: cap outbound requests to the KV API at a conservative rate (e.g. ≤1 req/sec aggregate). Add jitter on the poll interval to avoid thundering-herd alignment.
- **HTTP client**: connection pooling, configurable timeouts (connect 5s, read 30s), automatic retry with exponential backoff on 5xx and IO errors. No retry on 4xx (except 429 with `Retry-After`).
- **Observability**: emit metrics for: tick duration, locations discovered, reviews discovered, receipts processed, no-receipt count, S3 errors, API errors, watermark age. Log at INFO with correlation IDs per tick.
- **Configuration**: all of the following must be configurable via environment variables, not hardcoded:
  - `KV_API_BASE_URL`
  - `KV_PUBLICATION_API_TOKENS` (list, one per tenant)
  - `S3_BUCKET_NAME`
  - `AWS_REGION` (default `eu-central-1`)
  - `POLL_INTERVAL_SECONDS` (default 300)
  - `WATERMARK_SAFETY_SECONDS` (default 60)
  - `PAGE_SIZE` (default 200)
  - `WORKER_CONCURRENCY` (default 4)
  - `API_RATE_LIMIT` (default 1) - defined as seconds accepting floats for sub second values
- **State store schema**:
  ```sql
  CREATE TABLE receipt_sync_state (
      review_id         VARCHAR(64) PRIMARY KEY,
      tenant_id         INT NOT NULL,
      location_id       VARCHAR(64) NOT NULL,
      receipt_content   JSON,                  -- Processable info extracted from the receipt
      status            VARCHAR(16) NOT NULL,  -- PROCESSED | NO_RECEIPT | FAILED
      s3_key            VARCHAR(255),
      s3_etag           VARCHAR(64),
      attempt_count     INT NOT NULL DEFAULT 0,
      processed_at      TIMESTAMP NOT NULL,
      error_message     TEXT
  );
  CREATE TABLE receipt_sync_watermark (
      tenant_id  INT PRIMARY KEY,
      watermark  TIMESTAMP NOT NULL
  );
  ```
- **Health endpoint**: expose `/health` that returns 200 if the last successful tick was within `2 * POLL_INTERVAL`, otherwise 503.

## Non-goals

- Do not modify, write, or delete S3 objects.
- Do not call any KV write endpoints.
- Do not attempt to backfill reviews older than 30 days through the API; that requires a separate process and is out of scope.

## Values to fill in before deploying

| Placeholder | Where to get it | Notes |
|---|---|---|
| `KV_API_BASE_URL` | Platform team | Production URL of the KV portal API. The repo only has `localhost:8080` placeholders. |
| `KV_PUBLICATION_API_TOKENS` | Platform team / per-tenant admin | One token per tenant (98, 99, ...). Token must have `PUBLICATION_API_PARTNER_PLUS` role and the locations must have the `PUBLICATION_API` feature enabled. |
| `S3_BUCKET_NAME` | AWS account owner | The bucket configured as `amazon.s3.bucket-name` in the source platform. Repo value is `REPLACE`. |
| AWS credentials | AWS account owner | IAM role preferred. Permissions: `s3:ListBucket`, `s3:GetObject` on `arn:aws:s3:::<bucket>` and `arn:aws:s3:::<bucket>/*`. |

---
# Changes

## [043] Fix UI not updating after receipt reprocessing

**What**: Dashboard `handleReprocess` now reads the SSE stream from the OCR endpoint and waits for the `"completed"` event before refreshing data.
**Why**: The OCR endpoint returns a streaming response; the old code checked `response.ok` (which is true immediately on stream open) and called `fetchReceipts()` before processing finished, so the DB still had stale data.

## [042] Fix Kiyoh TOTP generation and add token caching

**What**: Fixed `Secret.fromBase32()` usage in TOTP generation (was passing raw string, producing wrong OTP codes) and added in-memory bearer token caching with 25-minute TTL to avoid re-authenticating on every API call.
**Why**: Every OTP code was invalid because the otpauth library treated the base32 secret as a raw UTF-8 string. Each failed OTP counted as a failed login attempt on Kiyoh's side, triggering account lockout even on a single disable attempt.
**Decisions**:
- 25-minute cache TTL (conservative, avoids expired token on actual API calls)
- Service retries once on 401 from the review-active endpoint (invalidates cache, re-authenticates, retries)
- Removed logging of request bodies that contained credentials and OTP codes
**Files**: `lib/review-disable/kiyoh-auth-client.ts`, `lib/review-disable/review-disable-service.ts`, `tests/services/review-disable-service.test.ts`

## [041] Add i18n infrastructure with next-intl and language selector

**What**: Installed next-intl, set up cookie-based locale persistence, added a language selector dropdown in the header, created full translation files for all 8 languages, and wired up `useTranslations()` in all page components.
**Decisions**:
- Cookie-based locale persistence (`NEXT_LOCALE`) set directly on the client — no async API call needed for switching
- `window.location.reload()` after cookie set to ensure clean server re-render (no flash)
- Removed Accept-Language detection to avoid flash between detected locale and cookie locale
- Default locale is `nl` (Dutch) since the primary audience is Dutch
- Split `lib/i18n.ts` (server-only) from `lib/i18n-config.ts` (shared constants) to avoid `next/headers` import in client components
- Removed Pino transport worker (was causing crashes in Next.js dev mode webpack bundling)
**Files**: `lib/i18n.ts`, `lib/i18n-config.ts`, `next.config.js`, `app/layout.tsx`, `app/api/locale/route.ts`, `components/language-selector.tsx`, `components/header.tsx`, `app/login/page.tsx`, `app/signup/page.tsx`, `app/dashboard/page.tsx`, `app/archive/page.tsx`, `app/admin/page.tsx`, `app/admin/moderation/page.tsx`, `app/admin/reviews/page.tsx`, `app/admin/settings/automation/page.tsx`, `lib/logger.ts`, `messages/*.json`

## [040] Move admin nav tabs from dashboard into header

**What**: Removed the tab-style admin buttons (Review Moderatie, Review Platforms, Admin Panel) from the dashboard page and added Moderation/Platforms links to the header nav. Renamed header "Reviews" button to "Platforms". Removed the "Review Platforms (Full)" tab from the admin page since it's now accessible via the header.
**Files**: `app/dashboard/page.tsx`, `components/header.tsx`, `app/admin/page.tsx`

## [039] Remove dead Review Queue tab from dashboard

**What**: Removed the non-functional "Review Queue" tab button and its associated state/data-fetching from the dashboard page.
**Why**: The tab set `activeTab` to `"queue"` but no UI rendered for that state, leaving users with a blank screen.

## [038] Fix admin page crash from paginated receipts response

**What**: Admin page called `.filter()` on the raw API response object instead of extracting the `receipts` array from the pagination envelope introduced in [035].
**Why**: Change [035] wrapped the `/api/receipts` response in `{ receipts, nextCursor, hasMore }` but the admin page fetch was never updated.

## [037] Use POLL_INTERVAL_SECONDS env var for dashboard auto-refresh

**What**: Dashboard pending-receipt polling now uses the server-configured `POLL_INTERVAL_SECONDS` instead of a hardcoded 5-second interval.
**Decisions**:
- Poll interval is included in the `/api/receipts` JSON response so the client component can read it without `NEXT_PUBLIC_` prefix
- Falls back to 300s (5 min) if env var is missing or invalid
**Files**: `app/api/receipts/route.ts`, `app/dashboard/page.tsx`

## [036] Add app-dev container for local development with hot reload

**What**: Added `app-dev` service to docker-compose that bind-mounts source code and runs `npm run dev` for live reload on file changes.
**Decisions**:
- Reuses the `dependencies` Dockerfile stage (has node_modules installed, no build step)
- Anonymous volume for `/app/node_modules` prevents host overwriting container deps
- `WATCHPACK_POLLING=true` ensures file-change detection works across Docker filesystem boundaries
- Runs `prisma generate` before dev server to ensure client is up to date

## [035] Add infinite scroll pagination to receipt list

**What**: Dashboard receipt list now loads 15 receipts at a time with cursor-based pagination and infinite scroll
**Decisions**:
- Cursor-based pagination using Prisma's `cursor` + `skip: 1` pattern for stable ordering
- IntersectionObserver on a sentinel div at the bottom of the table triggers loading more
- API response changed from flat array to `{ receipts, nextCursor, hasMore }` envelope
**Files**: `app/api/receipts/route.ts`, `lib/services/receipt-service.ts`, `app/dashboard/page.tsx`, `tests/routes/receipts.test.ts`, `tests/services/receipt-service.test.ts`

## [034] Fix OCR for KV-synced receipts and GPT-5.4 nano compatibility

**What**: Fixed OCR processing for receipts synced from KV (stored in separate S3 bucket), switched `max_tokens` to `max_completion_tokens` for GPT-5.4 nano, added error body logging to LLM API calls, fixed Kiyoh auth URL and tenantId.
**Decisions**:
- OCR route now detects `kv-sync:` prefix and uses KvS3Client to fetch from the correct bucket
- `max_completion_tokens` replaces deprecated `max_tokens` for newer OpenAI models
- Auth URL corrected to `klantenvertellen.nl` (not `kiyoh.com`), tenantId corrected to 99
**Files**: `app/api/receipts/[id]/ocr/route.ts`, `lib/services/ocr-service.ts`, `lib/review-disable/kiyoh-auth-client.ts`, `app/admin/reviews/page.tsx`, `tests/services/ocr-service.test.ts`, `tests/services/review-disable-service.test.ts`

## [033] Add review disable/enable on failed verification

**What**: Disable (and re-enable) reviews on KlantenVertellen when receipt verification fails, with Kiyoh admin TOTP auth, auto-disable on rejection, and manual disable form.
**Decisions**:
- Tokens not cached (admin operations are infrequent)
- Auto-disable is fire-and-forget (non-blocking) controlled by RECEIPT_AUTO_DISABLE_ENABLED env var
- Manual disable form accepts raw reviewId/locationId/tenantId without requiring a linked receipt
- Added `otpauth` dependency for TOTP generation
**Files**: `lib/review-disable/kiyoh-auth-client.ts`, `lib/review-disable/review-disable-service.ts`, `app/api/admin/reviews/disable/route.ts`, `app/api/admin/receipts/route.ts`, `app/admin/reviews/page.tsx`, `tests/services/review-disable-service.test.ts`, `messages/*.json`

## [032] Fix KV API response parsing and process reviews per-location

**What**: Fixed locations URL (removed `dateSince`, only `updatedSince`), fixed reviews response parsing (`response.reviews[]` with `dateSince` as creation date), restructured sync engine to process reviews immediately per-location with resumability.
**Decisions**:
- Locations endpoint only needs `updatedSince` (returns locations with new reviews, not newly created)
- Reviews response is `{ reviews: [{ reviewId, dateSince, reviewAuthor, rating, ... }] }` — mapped to internal `ReviewDto`
- Process reviews immediately after each location fetch (receipts appear in admin as they're found)
- Track location progress via marker records in `ReceiptSyncState` so interrupted ticks resume from last location
- Default backfill changed from 30 days to 5 days
**Files**: `lib/receipt-sync/kv-api-client.ts`, `lib/receipt-sync/sync-engine.ts`, `lib/receipt-sync/types.ts`, `lib/services/receipt-sync-service.ts`, `app/api/admin/receipt-sync/backfill/route.ts`, `scripts/backfill-sync.sh`

## [031] Fix KV API client URLs and add backfill script

**What**: Fixed incorrect API endpoint paths in `kv-api-client.ts` to match the real KV publication API; added `scripts/backfill-sync.sh` for triggering backfill from CLI.
**Decisions**:
- Locations uses offset-based pagination (`start` param), reviews uses `pageNumber` — matching the actual API
- Reviews endpoint returns `{ reviews: [...] }` wrapper, not a bare array — added response unwrapping
- `KV_API_BASE_URL` should be set to `https://www.klantenvertellen.nl/v1/publication` (includes the `/v1/publication` path prefix)
- Backfill script authenticates via NextAuth cookie flow (CSRF → credentials callback → session cookie)
**Files**: `lib/receipt-sync/kv-api-client.ts`, `.env.example`, `scripts/backfill-sync.sh`

## [030] Extract receipt-sync-service and fix pre-existing type errors

**What**: Moved business logic from receipt-sync route handlers into `lib/services/receipt-sync-service.ts`; fixed 5 pre-existing type errors across the codebase.
**Decisions**:
- Excluded `vitest.config.ts` from tsconfig (TS 5.2 can't parse `@vitejs/plugin-react@6` type defs)
- Added `getFileUrl` to `StorageUploadClient` interface (was missing, causing type mismatch with `StorageClient`)
- Cast `RequestInit` to `Record<string, unknown>` in test helpers (Next.js `RequestInit` type doesn't accept `signal: null`)
- Service uses dependency injection consistent with other services
**Files**: `tsconfig.json`, `lib/services/receipt-sync-service.ts`, `lib/services/drive-service.ts`, `app/api/admin/receipt-sync/health/route.ts`, `app/api/admin/receipt-sync/backfill/route.ts`, `tests/routes/admin.test.ts`, `tests/routes/drive.test.ts`, `tests/routes/receipts.test.ts`, `tests/routes/reviews.test.ts`, `tests/services/drive-service.test.ts`

## [029] Add unit tests for ocr-service

**What**: Created `tests/services/ocr-service.test.ts` with 19 unit tests covering all exported OCR service functions
**Decisions**:
- Mocks global fetch directly for API call tests rather than module-level mocking
- Tests verification status logic against actual priority order (verified check before duplicate check)
- Saves/restores process.env for config tests

## [028] Add unit tests for receipt-service

**What**: Created `tests/services/receipt-service.test.ts` with 26 unit tests covering all exported service functions
**Decisions**:
- Uses dependency injection directly (no module-level mocking needed)
- Tests both success and error paths for each function
- Covers access control, fraud pipeline, admin action logging, and date grouping

## [027] Rewire all route handlers to delegate to service functions

**What**: Converted 21 route handlers into thin wrappers (parse → auth → service → respond)
**Decisions**:
- Drive routes keep inline getAccessToken/triggerOCR to preserve exact test behavior (service's refreshGoogleToken adds env var checks not present in original)
- Automation PATCH/DELETE keep direct prisma calls since service adds existence checks the original didn't have
- OCR streaming route delegates message building and API call to ocr-service but keeps stream handling inline
- Admin receipts route unchanged (already thin, no matching service function needed)
**Files**: All 21 route.ts files under app/api/

## [026] Extract upload-service module

**What**: Created `lib/services/upload-service.ts` with generateUploadUrl (file type validation + presigned URL generation)
**Decisions**:
- StorageClient interface abstracts the presigned URL generation for testability
- Allowed content types defined as a named constant array
- Returns discriminated union result type consistent with auth-service pattern

## [025] Extract admin-service module

**What**: Created `lib/services/admin-service.ts` with getDashboardStats, listUsers, updateUserRole
**Decisions**:
- Super-admin emails stored as a named constant array (matches existing hardcoded list)
- updateUserRole returns statusCode in error case so route handler can map to correct HTTP status
- getDashboardStats preserves the exact same query structure and response shape as the current route

## [024] Extract automation-service module

**What**: Created `lib/services/automation-service.ts` with listWorkflows, getWorkflow, createWorkflow, updateWorkflow, deleteWorkflow, executeWorkflow
**Decisions**:
- Platform credentials passed via dependency object rather than reading process.env inside the service
- Delegates actual execution to existing lib/automation/executor.ts (no duplication)
- executeWorkflow returns structured response matching the current route's JSON shape for easy rewiring

## [023] Extract drive-service module

**What**: Created `lib/services/drive-service.ts` with getAccessToken, listDriveFiles, and importDriveFile
**Decisions**:
- Delegates token refresh to auth-service's refreshGoogleToken instead of duplicating OAuth logic
- Delegates receipt creation to receipt-service's createReceipt with fraud detection
- Delegates OCR to ocr-service's processReceiptOcr (fire-and-forget, non-blocking)
- Storage upload interface accepts generatePresignedUploadUrl + getFileAsBuffer for testability

## [022] Extract review-platform-service module

**What**: Created `lib/services/review-platform-service.ts` with fetchLocations, fetchReviewsForLocation, moderateReview, fetchPendingReviews, fetchNotificationCount
**Decisions**:
- Token passed explicitly per call rather than via dependency object (no DB/storage needed)
- Sequential fetching with rate-limit delay preserved from original moderation route
- Pending status detection uses set-based lookup instead of chained OR conditions

## [021] Extract ocr-service module

**What**: Created `lib/services/ocr-service.ts` with buildOcrMessages, buildOcrMessagesWithFileUpload, callOcrApi, parseOcrResult, determineVerificationStatus, processReceiptOcr
**Why**: Deduplicates OCR logic from receipts/[id]/ocr (streaming) and drive/import (non-streaming) routes
**Decisions**:
- Returns raw Response from callOcrApi so route handlers control streaming vs non-streaming consumption
- buildOcrMessagesWithFileUpload handles the OpenAI Files API upload path for PDFs (streaming route)
- buildOcrMessages uses base64 data URI fallback (non-streaming route and PDF upload failure)
- FraudDetectionClient interface decouples from the singleton fraud-detection module

## [020] Extract receipt-service module

**What**: Created `lib/services/receipt-service.ts` with listReceipts, getReceipt, createReceipt, updateReceiptStatus, archiveReceipts, listArchivedReceipts, getDownloadUrl
**Decisions**:
- FraudDetectionModule passed as explicit parameter to createReceipt (avoids importing singleton)
- StorageClient interface abstracts S3 operations (getFileUrl, getFileAsBuffer)
- Fraud pipeline failure is non-fatal — proceeds with zero-risk defaults

## [019] Extract auth-service module

**What**: Created `lib/services/auth-service.ts` with validateCredentials, registerUser, and refreshGoogleToken
**Why**: First service extraction — consolidates duplicated token refresh logic and isolates auth business logic from route handlers
**Decisions**:
- Discriminated union result types instead of throwing errors
- Input validation (Zod) happens inside registerUser since it's a boundary function
- refreshGoogleToken accepts accountId and handles both fresh-token and refresh cases
## [018] Add property-based tests for receipt-sync service

**What**: Created `tests/receipt-sync/properties.test.ts` with 8 property-based tests (16 assertions) using fast-check covering watermark safety subtraction, pagination termination, watermark max-date advancement, idempotent skip logic, dead letter eligibility, health status determination, auto-verify flag, and jitter bounds.
**Decisions**:
- Used integer-based date generators (mapped to Date) instead of `fc.date()` to avoid NaN date edge cases
- Tested pure logic functions inline rather than importing from modules that have side effects
- Imported `computeJitter` directly from `@/lib/receipt-sync` since it's exported
**Files**: `tests/receipt-sync/properties.test.ts`, `package.json`

## [017] Add receipt-sync health and backfill API routes

**What**: Created GET `/api/admin/receipt-sync/health` (returns 200/503 based on last tick recency vs 2×POLL_INTERVAL_SECONDS) and POST `/api/admin/receipt-sync/backfill` (admin-auth, sets watermark to now-30d, executes immediate tick, requires force if watermark already recent).
**Decisions**:
- Health endpoint has no auth (for monitoring systems); backfill requires admin session
- Backfill returns 409 conflict when watermark is within 30 days without force flag
**Files**: `app/api/admin/receipt-sync/health/route.ts`, `app/api/admin/receipt-sync/backfill/route.ts`

## [016] Implement receipt-sync module

**What**: Created the full `lib/receipt-sync/` module with config loading, KV API client (paginated AsyncGenerator with rate limiting and retry), dedicated S3 client for eu-central-1, Prisma state repository, receipt creator, sync engine with concurrency-limited tick execution, and singleton sync loop with jitter.
**Decisions**:
- Created shared `lib/logger.ts` (pino-based) per AGENTS.md rules — installed pino dependency
- Added `npm run check` script (tsc --noEmit) since it was missing
- System user created on-demand with cached ID for receipt creation
- Jitter computed as random 0–10% of poll interval per requirement 4.6
- S3 operations gracefully disabled when bucket name is not configured
**Files**: `lib/logger.ts`, `lib/receipt-sync/types.ts`, `lib/receipt-sync/config.ts`, `lib/receipt-sync/kv-api-client.ts`, `lib/receipt-sync/kv-s3-client.ts`, `lib/receipt-sync/state-repository.ts`, `lib/receipt-sync/receipt-creator.ts`, `lib/receipt-sync/sync-engine.ts`, `lib/receipt-sync/index.ts`, `package.json`

## [015] Add receipt sync Prisma models and environment variables

**What**: Added ReceiptSyncState, ReceiptSyncWatermark, and ReceiptSyncTick models to the Prisma schema with indexes, created the migration SQL, and added all receipt sync service environment variables to .env.example.
**Decisions**:
- Migration created manually (database not available in CI) — needs `prisma migrate deploy` on next startup
- Separate S3 credentials (KV_RECEIPT_AWS_*) to avoid conflicting with existing R2 config
**Files**: `prisma/schema.prisma`, `prisma/migrations/20260601000000_add_receipt_sync_models/migration.sql`, `.env.example`

## [014] Add AI integration test for OCR extraction

**What**: Created `tests/ai-integration/ocr-extraction.test.ts` that sends the fixture image to the real AI API and validates the response schema
**Decisions**:
- Self-contained test — constructs the API call directly without importing app code
- Skips gracefully via `describe.skipIf` when `AI_API_KEY` is not set
- Validates all six schema fields: extractedShopName, extractedDate, extractedAmount, receiptReadable, confidence, reasoning

## [013] Add unit tests for fraud detection module

**What**: Created `tests/lib/fraud-detection.test.ts` with 43 tests covering all exported functions
**Decisions**:
- Pure functions tested directly (calculateImageHash, analyzeMetadata, calculateFraudRiskScore)
- DB-dependent functions (checkForDuplicates, detectSuspiciousPatterns) tested with mocked Prisma
- Covered edge cases: empty buffers, null/undefined values, boundary conditions, score capping

## [012] Add integration tests for automation routes

**What**: Created `tests/routes/automation.test.ts` with 33 tests covering workflows CRUD (GET list, POST create, GET single, PATCH update, DELETE) and execute POST (dry-run + live mode, error cases).
**Decisions**:
- Mocked `@/lib/automation/executor` to avoid Playwright dependency in tests
- Tested credential injection for both KV and Kiyoh platforms
- Covered corrupted steps, disabled workflows, and partial execution failure scenarios

## [011] Add integration tests for Google Drive routes

**What**: Created `tests/routes/drive.test.ts` with 19 tests covering files GET (token refresh, unauthorized, shared files) and import POST (full pipeline: download → S3 → receipt + fraud detection → OCR trigger).
**Decisions**:
- Used `decodeURIComponent` on URLs in fetch mock to reliably match Google Drive API query patterns
- Mocked the background OCR trigger by returning null from `receipt.findUnique` (triggerOCR exits early)

## [010] Add integration tests for review routes

**What**: Created `tests/routes/reviews.test.ts` with 34 tests covering locations GET, location reviews GET, moderate POST (abuse/changerequest/respond), moderation aggregation GET, and notifications GET.
**Decisions**:
- Used `Date.now()` spy to invalidate module-level memory cache between location tests
- Global `beforeEach` resets env vars (`KIYOH_API_TOKEN`, `KV_API_TOKEN`) to ensure test isolation

## [009] Add integration tests for auth routes

**What**: Created `tests/routes/auth.test.ts` with 18 tests covering login POST (valid/invalid/missing fields) and signup POST (valid/duplicate/validation errors).
**Decisions**:
- Mocked bcrypt at module boundary with both default and named exports to match how bcryptjs is imported
- Signup route lives at `app/api/signup/route.ts` (not under `app/api/auth/signup/`)

## [008] Add integration tests for receipt routes

**What**: Created `tests/routes/receipts.test.ts` with 38 tests covering GET list, POST create (with fraud detection), GET single, PATCH status, archive POST/GET, download GET, and presigned upload POST.
**Decisions**:
- Mocked `next-auth` directly (not `next-auth/next`) since route handlers import from `"next-auth"`
- Fraud detection functions mocked individually to verify they are called with correct arguments

## [007] Add shared test mock factories

**What**: Created `tests/helpers/` with reusable mock factories for Prisma, S3, session, and fetch used across all test files.
**Files**: `tests/helpers/mock-prisma.ts`, `tests/helpers/mock-s3.ts`, `tests/helpers/mock-session.ts`, `tests/helpers/mock-fetch.ts`, `tests/helpers/index.ts`

## [006] Auto-baseline existing databases on first migration

**What**: Entrypoint now catches P3005 (non-empty schema) and automatically marks the initial migration as applied before retrying, so existing databases transition to migrations without manual intervention.

## [005] Run database seed on staging startup

**What**: Entrypoint now runs `prisma db seed` when `NODE_ENV` is not `production`, so staging containers get seeded automatically on boot.

## [004] Run Prisma migrations on container startup

**What**: Added a shared entrypoint script that runs `prisma migrate deploy` before starting the app in both production and staging Docker targets.
**Files**: `scripts/docker-entrypoint.sh`, `Dockerfile`

## [003] Add missing CMD instructions to Dockerfile

**What**: Added `CMD` to both production and staging stages — containers were exiting immediately with code 0 because there was nothing to run.

## [002] Add health endpoint and update Railway config

**What**: Added `/api/health` endpoint that checks database connectivity; updated railway.toml to use it.
**Files**: app/api/health/route.ts, railway.toml

## [001] Add Docker and Docker Compose setup

**What**: Multi-stage Dockerfile (Alpine, Node 20, standalone output) and docker-compose with PostgreSQL.
**Decisions**:
- Used Alpine-based images for small footprint
- Next.js standalone output mode for minimal production image
- Added x86_64 Prisma binary target alongside existing ARM64 target
**Files**: Dockerfile, docker-compose.yml, .dockerignore, prisma/schema.prisma

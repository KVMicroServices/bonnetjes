# Changes

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

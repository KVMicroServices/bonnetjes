# Tasks

## Task 1: Set up Vitest and test infrastructure

- [x] Install Vitest and required dev dependencies (`vitest`, `@vitejs/plugin-react`, `vitest-mock-extended`)
- [x] Create `vitest.config.ts` at project root excluding `tests/ai-integration/**`
- [x] Create `tests/ai-integration/vitest.config.ts` for the isolated AI test suite
- [x] Add `"test": "vitest run"` and `"test:ai": "vitest run --config tests/ai-integration/vitest.config.ts"` to package.json scripts
- [x] Create `tests/helpers/` with shared mock factories for Prisma, S3, session, and fetch
- [x] Verify `npm test` runs and exits cleanly with zero tests

## Task 2: Write integration tests for all existing route behavior

- [x] Create `tests/routes/receipts.test.ts` — covers GET list, POST create (with fraud detection mocked), GET single, PATCH status, archive POST/GET, download GET, presigned upload POST
- [x] Create `tests/routes/auth.test.ts` — covers login POST (valid/invalid/missing), signup POST (valid/duplicate/validation errors)
- [x] Create `tests/routes/admin.test.ts` — covers admin receipts GET/PATCH, users GET/PATCH (including super-admin protection), stats GET
- [x] Create `tests/routes/reviews.test.ts` — covers locations GET, location reviews GET, moderate POST (abuse/changerequest/respond), moderation aggregation GET, notifications GET
- [x] Create `tests/routes/drive.test.ts` — covers files GET (with token refresh), import POST (download + S3 + receipt + OCR trigger)
- [x] Create `tests/routes/automation.test.ts` — covers workflows GET/POST/PATCH/DELETE, execute POST (dry-run + live)
- [x] Create `tests/lib/fraud-detection.test.ts` — unit tests for all pure functions (calculateImageHash, analyzeMetadata, calculateFraudRiskScore) and DB-dependent functions (checkForDuplicates, detectSuspiciousPatterns)
- [x] Run `npm test` and confirm all tests pass against current inline route logic

## Task 3: Create AI integration test with generated fixture

- [x] Generate a fake receipt image (`tests/ai-integration/fixtures/sample-receipt.jpg`) using a script or canvas — containing shop name, date, and amount text
- [x] Create `tests/ai-integration/ocr-extraction.test.ts` — sends fixture to real AI API, validates response matches expected JSON schema (extractedShopName, extractedDate, extractedAmount, receiptReadable, confidence, reasoning)
- [x] Verify `npm run test:ai` runs the AI test in isolation (requires `AI_API_KEY` env var)

## Task 4: Extract service modules and rewire route handlers

- [ ] Create `lib/services/auth-service.ts` — extract login validation, signup logic, Google token refresh
- [ ] Create `lib/services/receipt-service.ts` — extract receipt CRUD, archiving, listing, download URL, fraud pipeline
- [ ] Create `lib/services/ocr-service.ts` — extract OCR prompt building, LLM API call (streaming + non-streaming), result parsing, verification status determination
- [ ] Create `lib/services/review-platform-service.ts` — extract Kiyoh/KV location fetching, review fetching, moderation actions, pending aggregation, notifications
- [ ] Create `lib/services/drive-service.ts` — extract Drive file listing, file download + import (delegates to receipt-service and ocr-service)
- [ ] Create `lib/services/automation-service.ts` — extract workflow CRUD, execution with credential injection
- [ ] Create `lib/services/admin-service.ts` — extract stats aggregation, user management with super-admin protection
- [ ] Create `lib/services/upload-service.ts` — extract file type validation + presigned URL generation
- [ ] Rewire all route handlers to delegate to service functions (thin handlers: parse → auth → service → respond)
- [ ] Run `npm test` and confirm all integration tests still pass without modification

## Task 5: Add unit tests for extracted services

- [ ] Create `tests/services/receipt-service.test.ts`
- [ ] Create `tests/services/ocr-service.test.ts`
- [ ] Create `tests/services/auth-service.test.ts`
- [ ] Create `tests/services/review-platform-service.test.ts`
- [ ] Create `tests/services/drive-service.test.ts`
- [ ] Create `tests/services/automation-service.test.ts`
- [ ] Create `tests/services/admin-service.test.ts`
- [ ] Create `tests/services/upload-service.test.ts`
- [ ] Run full suite (`npm test`) and confirm everything passes

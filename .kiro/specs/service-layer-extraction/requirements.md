# Requirements Document

## Introduction

Extract the inline business logic from all Next.js route handlers into dedicated service modules under `lib/services/`. A comprehensive integration test suite is written first against the current route behavior to act as a safety net, then the business logic is moved into service modules. External behavior (HTTP responses, status codes, payloads) must remain identical after extraction.

## Glossary

- **Route_Handler**: A Next.js App Router `route.ts` file that handles HTTP requests and returns responses
- **Service_Module**: A TypeScript module under `lib/services/` containing extracted business logic for a specific domain
- **Service_Layer**: The collection of all Service_Modules created during this extraction
- **Integration_Test**: A test that exercises a route handler end-to-end with mocked database and external dependencies
- **Domain_Group**: A logical grouping of related routes — receipts, auth, admin, reviews, drive, automation, ai

## Requirements

### Requirement 1: Integration test coverage for all existing route behavior

**User Story:** As a developer, I want a test suite that captures the current behavior of all route handlers, so that I can safely refactor without breaking anything.

#### Acceptance Criteria

1. THE Integration_Test suite SHALL cover all route handlers across every Domain_Group: receipts (CRUD, OCR, download, archive), auth (login, signup), admin (receipts, users, stats), reviews (locations, moderation, moderate), drive (files, import), automation (workflows CRUD, execute), and ai (OCR extraction, verification status determination)
2. THE Integration_Test suite SHALL verify correct HTTP status codes for success, unauthorized, forbidden, not-found, and bad-request scenarios per route
3. THE Integration_Test suite SHALL mock Prisma, S3, external APIs (OpenAI, Google Drive, Kiyoh/KV), and bcrypt at the module boundary rather than requiring live infrastructure
4. THE Integration_Test suite SHALL use synthetic test fixtures (predefined receipt objects, dummy file buffers, controlled LLM response payloads) to exercise business logic paths without requiring real receipt images or AI inference
5. THE Integration_Test suite SHALL verify that business logic side effects occur correctly (fraud detection fields persisted, admin actions logged, tokens refreshed)

### Requirement 2: Extract business logic into domain service modules

**User Story:** As a developer, I want all business logic in dedicated service modules, so that route handlers stay thin and logic is testable in isolation.

#### Acceptance Criteria

1. THE Service_Layer SHALL contain one Service_Module per Domain_Group: receipt-service, auth-service, admin-service, review-service, drive-service, automation-service, and ai-service
2. WHEN a Service_Module function is called, THE Service_Module SHALL accept explicit dependencies (database client, storage client, external API clients) as parameters rather than importing singletons directly
3. THE Service_Layer SHALL preserve identical business rules to the current inline implementations (fraud scoring, access control logic, verification status determination, token refresh, moderation actions, OCR extraction and result processing)
4. THE ai-service SHALL encapsulate the OCR prompt construction, LLM API communication, result parsing, date validation, and verification status determination logic currently duplicated in the receipts OCR route and drive import route
5. AFTER extraction, each Route_Handler file SHALL contain only request parsing, authentication, service delegation, and response formatting

### Requirement 3: AI API integration tests are separate from the main suite

**User Story:** As a developer, I want real AI API call tests isolated from the main test suite, so that `npm test` runs fast without requiring API keys, while I can still manually verify AI behavior when needed.

#### Acceptance Criteria

1. THE main test suite (`npm test`) SHALL mock all AI/LLM API calls and never hit a real endpoint
2. A separate command (`npm run test:ai`) SHALL run integration tests that make real API calls to the configured AI provider
3. THE AI integration tests SHALL be placed in a dedicated directory (e.g., `tests/ai-integration/`) excluded from the default test configuration
4. THE AI integration tests SHALL verify real OCR extraction against sample receipt images, validating that the AI returns parseable JSON with the expected schema

### Requirement 4: Existing integration tests pass after extraction

**User Story:** As a developer, I want confirmation that the refactoring did not change external behavior, so that I can ship with confidence.

#### Acceptance Criteria

1. WHEN the extraction is complete, THE Integration_Test suite from Requirement 1 SHALL pass without modification
2. IF a test fails after extraction, THEN THE Service_Module SHALL be corrected to match the original behavior

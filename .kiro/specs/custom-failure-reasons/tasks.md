# Implementation Plan: Custom Failure Reasons

## Overview

Adds admin-managed failure reasons with AI-translated descriptions. 7 tasks across 5 waves — DB model first, then service + translator in parallel, then API/email/OCR integration + UI in parallel, then migration cleanup, then tests.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2", "3"] },
    { "id": 2, "tasks": ["4", "5"] },
    { "id": 3, "tasks": ["6"] },
    { "id": 4, "tasks": ["7"] }
  ]
}
```

## Tasks

- [x] 1. Add FailureReasonDefinition Prisma model and migration
  - Add `FailureReasonDefinition` model to `prisma/schema.prisma` with fields: `code` (String @id), `description` (String), `isBuiltIn` (Boolean @default(false)), `enabled` (Boolean @default(true)), `nl` (String?), `de` (String?), `fr` (String?), `es` (String?), `af` (String?), `xh` (String?), `zu` (String?), `createdAt` (DateTime @default(now())), `updatedAt` (DateTime @updatedAt)
  - Run `npx prisma migrate dev` to generate the migration
  - Run `npx prisma generate` to update the client
  - **Requirements:** 1.1, 1.2, 1.3, 1.4

- [x] 2. Create failure-reason-translator service
  - Create `lib/services/failure-reason-translator.ts` with `translateDescription(description: string): Promise<TranslationResult>` that sends a single prompt to the AI API requesting translations for nl, de, fr, es, af, xh, zu and parses the JSON response
  - Add `generateDescriptionFromCode(code: string): Promise<string>` that sends the reason code to the AI API and returns a suggested English description sentence
  - Handle failures gracefully: log errors, return `{ success: false }` for translation and throw for generation (caller handles)
  - Use the existing `AI_API_BASE_URL`, `AI_API_KEY`, and `AI_MODEL_NAME` env vars for the API calls
  - **Requirements:** 4.1, 4.2, 4.3, 4.4, 8.2

- [x] 3. Create failure-reason-service with CRUD and seeding
  - Create `lib/services/failure-reason-service.ts` with `ensureBuiltInReasonsSeeded()` that lazily seeds built-in reasons from `FAILURE_REASONS` codes and existing message file English descriptions, populating locale columns from existing message file translations
  - Add `getAllFailureReasons()`, `createFailureReason(code, description)`, `updateFailureReasonDescription(code, description)`, `deleteFailureReason(code)` with validation (code format, uniqueness, built-in protection)
  - Add `getFailureReasonTranslation(code, locale)` that returns the locale column value for a given code, or null if not found
  - Add `getEnabledFailureReasonsWithDescriptions()` that returns all enabled reasons with code and description
  - Wire `createFailureReason` and `updateFailureReasonDescription` to call `translateDescription` from the translator (dirty check on update)
  - **Requirements:** 1.5, 2.1–2.5, 3.1–3.5, 5.1, 6.2, 7.1–7.3

- [x] 4. Create API routes and integrate with email/OCR systems
  - Create `app/api/admin/failure-reasons/route.ts` with GET (list all), POST (create), PATCH (update description), DELETE (delete custom) handlers — all require admin auth
  - Create `app/api/admin/failure-reasons/generate/route.ts` with POST handler that calls `generateDescriptionFromCode` and returns the suggestion
  - Update `lib/email/email-translations.ts`: add DB lookup via `getFailureReasonTranslation` before the message file fallback (wrapped in try/catch)
  - Update OCR prompt building: when no custom prompt is set, call `getEnabledFailureReasonsWithDescriptions()` and build the failure reason list dynamically
  - **Requirements:** 5.1–5.5, 6.1, 6.3, 6.4, 7.4, 8.2

- [x] 5. Update admin settings UI for failure reason management
  - Replace the current failure reasons toggle section with a full management section: list all reasons with code, description, enabled toggle, built-in badge, delete button for custom only
  - Add a "New Reason" form with code input (uppercase + underscores validation) and description textarea
  - Add inline editing of the English description with Save button, and a "Generate" button that calls the generate endpoint
  - Add loading states for translation and generation, confirmation dialog for delete
  - Add translation keys to all 8 message files
  - **Requirements:** 3.6, 7.5, 7.6, 8.1–8.5, 9.1–9.6

- [x] 6. Migrate existing enabledFailureReasons setting to model
  - In `ensureBuiltInReasonsSeeded()`, check if `SETTING_ENABLED_FAILURE_REASONS` has a stored value — if so, apply it to `enabled` flags on seeded reasons, then delete the AppSetting key
  - Remove `enabledFailureReasons` from `AppSettings` interface, `getAppSettings()`, the PATCH handler, and the GET response
  - Remove `getEnabledFailureReasons()` call from `ocr-service.ts` processReceiptOcr (replaced by dynamic prompt building)
  - Update affected tests
  - **Requirements:** 1.2, 6.3

- [x] 7. Unit tests for failure-reason-service and failure-reason-translator
  - Create `tests/services/failure-reason-service.test.ts`: seeding idempotency, CRUD validation, dirty check, translation fallback
  - Create `tests/services/failure-reason-translator.test.ts`: mock AI API, verify prompt structure, handle failures
  - Create `tests/routes/failure-reasons.test.ts`: auth guards, validation errors, success paths for all endpoints
  - **Requirements:** All

## Notes

- Translation is synchronous on save (admin waits a few seconds for the AI response). If this becomes a UX issue, it can be moved to a background job later.
- The seeding reads from `messages/*.json` files at runtime — same pattern used by `email-translations.ts`.
- Existing receipts with deleted custom reason codes keep their `failureReason` field unchanged (no FK constraint).

# Technical Design

## Overview

This feature adds a `FailureReasonDefinition` Prisma model to store failure reasons (built-in and custom) with per-locale translations. A new `failure-reason-service.ts` handles CRUD and translation orchestration. The email translation loader gains a DB-first lookup. The OCR prompt builder reads enabled reasons from the DB. A new API route handles failure reason operations, and the admin settings page gets an expanded failure reasons management section.

## Architecture

The feature follows the existing pattern: a Prisma model for persistence, a service layer for business logic, an API route for HTTP access, and the admin settings page for UI. The translation service is a thin wrapper around the existing AI API client.

```
Admin UI (settings page)
    ↓ fetch
API Route (/api/admin/failure-reasons)
    ↓ delegates
failure-reason-service.ts (CRUD, validation, seeding)
    ↓ triggers
failure-reason-translator.ts (AI API calls for translation + generation)
    ↓ persists
FailureReasonDefinition (Prisma model)
    ↑ reads
email-translations.ts (DB-first lookup for localized text)
ocr-service.ts (reads enabled reasons for prompt building)
```

## Components and Interfaces

### Module Structure

```
lib/services/failure-reason-service.ts    — CRUD, translation orchestration, seeding
lib/services/failure-reason-translator.ts — AI translation + description generation
app/api/admin/failure-reasons/route.ts    — API route (GET, POST, PATCH, DELETE)
app/api/admin/failure-reasons/generate/route.ts — AI description generation endpoint
```

### API Endpoints

#### `GET /api/admin/failure-reasons`

Returns all failure reason definitions (built-in + custom).

Response: `FailureReasonDefinition[]`

#### `POST /api/admin/failure-reasons`

Creates a new custom failure reason. Triggers translation.

Request body:
```json
{ "code": "WRONG_STORE", "description": "The receipt is from a different store" }
```

Response: Created `FailureReasonDefinition` with translations populated (or null if translation failed).

#### `PATCH /api/admin/failure-reasons`

Updates the English description of an existing reason. Dirty check: only translates if description changed.

Request body:
```json
{ "code": "WRONG_STORE", "description": "Updated description text" }
```

Response: Updated `FailureReasonDefinition`.

#### `DELETE /api/admin/failure-reasons`

Deletes a custom failure reason. Rejects deletion of built-in reasons.

Request body:
```json
{ "code": "WRONG_STORE" }
```

Response: `{ success: true }`

#### `POST /api/admin/failure-reasons/generate`

Generates an English description from a reason code using AI.

Request body:
```json
{ "code": "WRONG_STORE" }
```

Response:
```json
{ "description": "The receipt is from a different store than the one being reviewed" }
```

### Service Interfaces

#### `failure-reason-service.ts`

```typescript
async function ensureBuiltInReasonsSeeded(): Promise<void>
async function getAllFailureReasons(): Promise<FailureReasonDefinition[]>
async function createFailureReason(code: string, description: string): Promise<FailureReasonDefinition>
async function updateFailureReasonDescription(code: string, description: string): Promise<FailureReasonDefinition>
async function deleteFailureReason(code: string): Promise<void>
async function getFailureReasonTranslation(code: string, locale: string): Promise<string | null>
async function getEnabledFailureReasonsWithDescriptions(): Promise<Array<{ code: string; description: string }>>
```

#### `failure-reason-translator.ts`

```typescript
interface TranslationResult {
  success: boolean;
  translations: {
    nl: string | null;
    de: string | null;
    fr: string | null;
    es: string | null;
    af: string | null;
    xh: string | null;
    zu: string | null;
  } | null;
  error?: string;
}

async function translateDescription(description: string): Promise<TranslationResult>
async function generateDescriptionFromCode(code: string): Promise<string>
```

### Email System Integration

In `lib/email/email-translations.ts`, the `loadDisableEmailTranslations` and `loadFinalRejectionEmailTranslations` functions gain a DB lookup step:

1. Call `getFailureReasonTranslation(failureReason, locale)` from the failure reason service
2. If it returns a non-null string, use it as `failureReasonText`
3. If null, fall back to existing message file lookup (current behavior)

The DB lookup is wrapped in try/catch — on failure, falls back silently with a log warning.

### OCR Prompt Integration

When a custom prompt is NOT set, the system will:

1. Call `getEnabledFailureReasonsWithDescriptions()` from the failure reason service
2. Build the failure reason list section dynamically: `- CODE: description` for each enabled reason
3. Inject this into the default criteria template

When a custom prompt IS set (admin edited the full prompt), the dynamic injection is skipped — the admin controls the full prompt text including which reasons to list.

### Interaction with Existing `enabledFailureReasons` Setting

The existing `SETTING_ENABLED_FAILURE_REASONS` in `AppSetting` will be migrated to use the `enabled` boolean on `FailureReasonDefinition` directly. The toggle switches in the admin UI will update the `enabled` field on the model instead of the separate `AppSetting` array.

Migration path:
- If `SETTING_ENABLED_FAILURE_REASONS` has a stored value, apply it to the `enabled` flags during seeding
- After migration, the `AppSetting` key is no longer used for this purpose

## Data Models

### FailureReasonDefinition

```prisma
model FailureReasonDefinition {
  code        String   @id
  description String
  isBuiltIn   Boolean  @default(false)
  enabled     Boolean  @default(true)
  nl          String?
  de          String?
  fr          String?
  es          String?
  af          String?
  xh          String?
  zu          String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

Flat column layout (one column per locale) chosen over JSON blob because:
- Direct querying by locale without JSON parsing
- Schema-enforced field presence
- Simpler reads in the email translation loader

### Seeding Strategy

On first access (lazy), `ensureBuiltInReasonsSeeded()` checks if built-in reason records exist. If not, it creates them with:
- `isBuiltIn: true`
- `enabled: true`
- `description`: The existing English text from `ReviewDisableEmail` namespace in `en.json`
- Locale columns: Populated from existing message file translations (no AI call needed for initial seed)

### Validation Rules

- Code: `^[A-Z][A-Z_]*[A-Z]$`, 2–50 chars (no leading/trailing underscores)
- Description: 1–500 chars, trimmed
- Built-in reasons cannot be deleted
- Code must be unique across all reasons

## Error Handling

- Translation failures are non-blocking: the reason is saved, translations remain null/previous
- DB failures in email lookup fall back to message files silently
- DB failures in OCR prompt building fall back to hardcoded `FAILURE_REASONS` list
- All errors logged via shared logger
- AI generation failures return an error response to the client (not silent)

## Testing Strategy

- Unit tests for `failure-reason-service.ts`: CRUD operations, seeding idempotency, validation
- Unit tests for `failure-reason-translator.ts`: mock AI API, verify prompt structure, handle failures
- Integration tests for the API route: auth checks, validation errors, success paths
- Test email translation fallback chain: DB hit → message file → English → code

## Correctness Properties

### Property 1: Code Uniqueness
A failure reason code is globally unique — no two records can share the same code.
**Validates: Requirements 1.4**

### Property 2: Receipt Integrity
Deleting a custom reason never modifies existing Receipt records that reference that code.
**Validates: Requirements 7.4**

### Property 3: Dirty Check
Translation is only triggered when the English description actually changes.
**Validates: Requirements 3.2, 3.3**

### Property 4: Email Fallback Chain
The email system always produces a non-empty failure reason text (DB → message file → English description → code as last resort).
**Validates: Requirements 5.2, 5.3, 5.4**

### Property 5: OCR Resilience
The OCR prompt always includes at least the built-in failure reasons even if the DB is unreachable.
**Validates: Requirements 6.4**

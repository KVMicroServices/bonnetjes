# Implementation Plan: Email Template Editor

## Overview

Adds an admin email template editor with DB-stored overrides, auto-translate via AI, and a live preview modal. 6 tasks across 4 waves — DB model first, then service + API in parallel, then email integration + UI in parallel, then tests.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2", "3"] },
    { "id": 2, "tasks": ["4", "5"] },
    { "id": 3, "tasks": ["6"] }
  ]
}
```

## Tasks

- [ ] 1. Add EmailTemplateOverride Prisma model and migration
  - Add `EmailTemplateOverride` model to `prisma/schema.prisma` with fields: `id` (String @id @default(cuid())), `emailType` (String), `key` (String), `locale` (String), `value` (String @db.Text), `createdAt` (DateTime @default(now())), `updatedAt` (DateTime @updatedAt), with `@@unique([emailType, key, locale])` and `@@index([emailType, locale])`
  - Run `npx prisma migrate dev` to generate the migration
  - Run `npx prisma generate` to update the client
  - **Requirements:** 1.1, 1.2, 1.3, 1.4

- [ ] 2. Create email-template-override-service
  - Create `lib/services/email-template-override-service.ts` with: `getOverridesForEmailType(emailType, locale)` returning a key→value map, `upsertOverride(emailType, key, locale, value)`, `deleteOverride(emailType, key, locale)`, `bulkUpsertOverrides(emailType, locale, entries)`, and `getDefaultValues(emailType)` that reads from the appropriate `messages/en.json` namespace
  - Add a constant mapping of email type to namespace name and to the list of valid translation keys for that type
  - All DB operations wrapped in try/catch with logger.error on failure
  - **Requirements:** 1.3, 1.4, 2.2, 5.1, 5.2, 5.3, 5.4

- [ ] 3. Create API routes (CRUD, translate, preview)
  - Create `app/api/admin/email-templates/route.ts` with GET (returns overrides merged with defaults for a given emailType + locale) and PATCH (upserts non-empty values, deletes empty ones) — admin auth required
  - Create `app/api/admin/email-templates/translate/route.ts` with POST that takes `{ emailType, sourceLocale, entries }` (entries = only dirty keys sent by the client), calls the AI API for each entry to translate to the other 7 locales, stores results via `bulkUpsertOverrides`, returns `{ translated, failed }`
  - Create `app/api/admin/email-templates/preview/route.ts` with POST that takes `{ emailType, overrides }`, merges with defaults, constructs sample data, calls the existing render function, returns `{ subject, html }`
  - **Requirements:** 2.4, 3.1, 3.2, 3.5, 4.1, 4.2, 4.4

- [ ] 4. Integrate overrides into email translation loader
  - Update `lib/email/email-translations.ts`: in each `load*Translations` function, call `getOverridesForEmailType` for the resolved email type and locale, merge any found overrides into the result object (override wins over message file)
  - Wrap the DB lookup in try/catch — on failure, log and continue with message file values only
  - **Requirements:** 5.1, 5.2, 5.3, 5.4, 5.5

- [ ] 5. Admin settings UI — email template editor section
  - Add an "Email Templates" card section to the admin settings page with: email type dropdown (4 options), editable textarea fields for each key of the selected type (pre-filled with override or default), human-readable labels for each key, a Save button, an Auto-translate button (enabled only when dirty keys exist, sends only modified keys) with loading state, and a Preview button that opens a modal with subject line + iframe rendering the HTML
  - Track dirty state per key (compare current value to last-saved value) — auto-translate button disabled when no keys are dirty, re-enabled when edits are made
  - Add translation keys to all 8 `messages/*.json` files for the `EmailTemplateEditor` namespace (labels, buttons, toasts, dropdown options)
  - **Requirements:** 2.1, 2.2, 2.3, 2.5, 3.3, 3.4, 4.1, 4.2, 4.3, 4.5, 6.1, 6.2, 6.3

- [ ] 6. Unit tests for email-template-override-service and API routes
  - Create `tests/services/email-template-override-service.test.ts`: upsert, delete, bulk upsert, getDefaults, DB error fallback
  - Create `tests/routes/email-templates.test.ts`: auth guards, validation, CRUD success paths, translate endpoint, preview endpoint
  - **Requirements:** All

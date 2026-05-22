# Design Document: Email Template Editor

## Overview

Adds an admin-facing email template editor to the settings page. Admins select an email type from a dropdown, edit translation key values in text fields, auto-translate to other locales via the AI API, and preview the rendered email in a modal iframe. Overrides are stored in a new `EmailTemplateOverride` table and consulted at email send time before falling back to `messages/*.json`.

## Architecture

### Database Model

New Prisma model `EmailTemplateOverride`:

```prisma
model EmailTemplateOverride {
  id        String   @id @default(cuid())
  emailType String
  key       String
  locale    String
  value     String   @db.Text
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([emailType, key, locale])
  @@index([emailType, locale])
}
```

Email types: `disable`, `verified`, `disputeVerified`, `finalRejection`

### Service Layer

New `lib/services/email-template-override-service.ts`:

- `getOverridesForEmailType(emailType, locale)` — returns all overrides for a type+locale as a key→value map
- `getOverrideValue(emailType, key, locale)` — returns a single override or null
- `upsertOverride(emailType, key, locale, value)` — creates or updates an override
- `deleteOverride(emailType, key, locale)` — removes an override (revert to default)
- `bulkUpsertOverrides(emailType, locale, entries: Array<{key, value}>)` — batch save for auto-translate results
- `getDefaultValues(emailType)` — reads the English defaults from `messages/en.json` for a given email type namespace

### Translation Integration

Modify `lib/email/email-translations.ts`:

- Each `load*Translations` function gains a DB lookup step: before reading from the message file, call `getOverridesForEmailType(emailType, locale)` and merge any found overrides into the result
- Wrapped in try/catch — on DB failure, falls back to existing behavior

### Auto-Translate Endpoint

New `app/api/admin/email-templates/translate/route.ts`:

- POST body: `{ emailType: string, sourceLocale: string, entries: Array<{key: string, value: string}> }`
- `entries` contains only the dirty keys (keys modified since last save) — the client tracks dirty state and sends only those
- For each entry, calls the AI API (same pattern as `failure-reason-translator.ts`) to translate the value into the other 7 locales
- Stores all translations via `bulkUpsertOverrides`
- Returns `{ translated: number, failed: string[] }`

### Preview Endpoint

New `app/api/admin/email-templates/preview/route.ts`:

- POST body: `{ emailType: string, overrides: Record<string, string> }`
- Merges provided overrides with defaults, constructs sample data (dummy reviewId, disputeUrl, shop name, etc.), calls the existing render function, returns `{ subject: string, html: string }`
- No email is sent — purely renders for preview

### CRUD Endpoint

New `app/api/admin/email-templates/route.ts`:

- GET `?emailType=disable&locale=en` — returns current overrides merged with defaults for that type
- PATCH body: `{ emailType, locale, overrides: Record<string, string> }` — upserts each non-empty value, deletes empty ones

### Admin UI

New component in the admin settings page (or a dedicated section):

- Dropdown: select email type (disable, verified, disputeVerified, finalRejection)
- For each translation key of the selected type: label + textarea, pre-filled with override or default
- "Save" button: PATCHes all fields
- "Auto-translate" button: POSTs to translate endpoint with current values
- "Preview" button: opens modal, POSTs to preview endpoint, renders subject + iframe with HTML

### Key Mapping

Each email type maps to specific translation keys (from the interfaces in `email-templates.ts`):

| Email Type | Namespace | Keys |
|---|---|---|
| `disable` | `ReviewDisableEmail` | subject, headerTagline, headerTitle, greeting, intro, guidelinesLinkText, requirementsIntro, requirementCompanyName, requirementDate, requirementOrderNumber, requirementCustomerName, disputePrompt, disputeButtonText, signOff, teamName, termsButtonText, privacyButtonText, questionsLabel, reasonLabel |
| `verified` | `ReceiptVerifiedEmail` | subject, headerTagline, headerTitle, greeting, body, thankYou, signOff, teamName, termsButtonText, privacyButtonText, questionsLabel, shopLabel, dateLabel, amountLabel |
| `disputeVerified` | `DisputeVerifiedEmail` | same keys as verified |
| `finalRejection` | `DisputeFinalRejectionEmail` | subject, headerTagline, headerTitle, greeting, body, reasonLabel, supportPrompt, signOff, teamName, termsButtonText, privacyButtonText, questionsLabel |

Note: `failureReasonText` is excluded — it comes from the failure reason system, not the template.

## Correctness Properties

- An override for (emailType, key, locale) always takes precedence over the message file value at send time
- Deleting an override (saving empty) reverts to the message file default
- Auto-translate never overwrites the source language — only the other 7
- Auto-translate only processes dirty keys (modified since last save) — unchanged keys are never re-sent to the AI API
- Preview uses the same render functions as actual email sending, ensuring WYSIWYG accuracy
- DB failures in the override lookup never break email sending — always falls back to message files

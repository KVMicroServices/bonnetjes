# Technical Design

## Overview

Adds email notifications when a review is disabled on Kiyoh/KlantenVertellen. The reviewer's email is fetched from the Kiyoh `GET v1/review` endpoint (authenticated session). Emails include the failure reason and a dispute link. A placeholder `/dispute` page is created for future implementation.

## Architecture

```
┌─────────────────────────┐
│  Review Disable Worker  │  (auto-disable after failed verification)
│  (BullMQ, concurrency 1)│
└──────────┬──────────────┘
           │ on success
           ▼
┌─────────────────────────┐      ┌──────────────────────────┐
│  resolveReviewerEmail() │─────▶│  Kiyoh GET v1/review     │
│  (kiyoh-review-client)  │      │  ?reviewId=X&tenantId=Y  │
└──────────┬──────────────┘      └──────────────────────────┘
           │ email resolved
           ▼
┌─────────────────────────┐      ┌──────────────────────────┐
│  sendDisableNotification│─────▶│  Gmail SMTP via          │
│  (email-service)        │      │  Nodemailer              │
└─────────────────────────┘      └──────────────────────────┘

Same flow for Disable_Route (manual disable by receipt / manual disable form)
```

## Components

### 1. `lib/email/email-service.ts` — Email Service

Reusable module for sending review-disable notification emails.

```typescript
interface SendDisableEmailParams {
  readonly recipientEmail: string;
  readonly locale: string;
  readonly reviewId: string;
  readonly locationId: string;
  readonly failureReason: string;
}

interface EmailResult {
  readonly success: boolean;
  readonly error?: string;
}

function sendReviewDisableEmail(params: SendDisableEmailParams): Promise<EmailResult>
```

Responsibilities:
- Creates Nodemailer SMTP transport from env vars (lazy singleton)
- Validates SMTP config at call time, returns failure if missing
- Loads translated strings from message JSON files for the given locale
- Renders HTML email with failure reason and dispute button
- Catches transport errors, logs via shared logger, returns failure result

The email HTML is a simple inline-styled template (no external template engine). The dispute button links to `${APP_URL}/dispute?reviewId=${reviewId}`.

### 2. `lib/email/email-templates.ts` — Email Template

Renders the HTML email body. Kept separate from transport logic for testability.

```typescript
interface DisableEmailData {
  readonly reviewId: string;
  readonly locationId: string;
  readonly failureReason: string;
  readonly disputeUrl: string;
  readonly translations: {
    readonly subject: string;
    readonly greeting: string;
    readonly body: string;
    readonly reasonLabel: string;
    readonly disputeButtonText: string;
    readonly footer: string;
  };
}

function renderDisableEmailHtml(data: DisableEmailData): string
function renderDisableEmailSubject(data: DisableEmailData): string
```

### 3. `lib/email/email-translations.ts` — Server-side Translation Loader

Loads translation strings from the message JSON files without requiring React or next-intl client infrastructure. Reads the JSON files directly since this runs in the queue worker (Node.js process, not Next.js request context).

```typescript
interface DisableEmailTranslations {
  readonly subject: string;
  readonly greeting: string;
  readonly body: string;
  readonly reasonLabel: string;
  readonly failureReasonText: string;
  readonly disputeButtonText: string;
  readonly footer: string;
}

function loadDisableEmailTranslations(locale: string, failureReason: string): DisableEmailTranslations
```

Reads from `messages/{locale}.json` under the `ReviewDisableEmail` namespace. Falls back to `en` if locale file or key is missing.

### 4. `lib/review-disable/kiyoh-review-client.ts` — Reviewer Email Resolution

Fetches the reviewer's email from the Kiyoh review API using the existing authenticated session.

```typescript
interface ReviewerEmailResult {
  readonly success: boolean;
  readonly email?: string;
  readonly error?: string;
}

function resolveReviewerEmail(reviewId: string, tenantId: number): Promise<ReviewerEmailResult>
```

Responsibilities:
- Calls `authenticateKiyohAdmin()` to get bearer token (reuses cached token)
- Calls `GET {KIYOH_REVIEW_API_BASE_URL}/../review?reviewId={reviewId}&tenantId={tenantId}&limit=1`
- Parses response, extracts `email` field from first ReviewDto
- Returns failure result on network error or missing email (never throws)

The base URL is derived from the existing `KIYOH_REVIEW_API_BASE_URL` env var (strips `/active` suffix to get the review base). A new env var `KIYOH_REVIEW_LIST_URL` can override this if needed, defaulting to `https://www.klantenvertellen.nl/v1/review`.

### 5. `app/dispute/page.tsx` — Dispute Page Placeholder

Minimal public page at `/dispute` that reads `reviewId` from search params and renders a placeholder message.

```typescript
// Server component, no auth required
export default function DisputePage({ searchParams }: { searchParams: { reviewId?: string } }) {
  // Renders: "Dispute system coming soon" with the reviewId displayed
}
```

### 6. Integration Points

#### Review Disable Worker (`lib/queue/review-disable-worker.ts`)

After the audit record is marked successful, add email notification:

```typescript
// After: await prisma.reviewDisableAudit.updateMany({ ... status: "success" ... })

// Resolve reviewer email from Kiyoh API
const emailResult = await resolveReviewerEmail(reviewId, tenantId);
if (!emailResult.success || !emailResult.email) {
  logger.warn({ receiptId, reviewId, error: emailResult.error }, "Could not resolve reviewer email, skipping notification");
} else {
  // Get failure reason from receipt
  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    select: { failureReason: true },
  });
  const failureReason = receipt?.failureReason || "VERIFICATION_FAILED";

  const sendResult = await sendReviewDisableEmail({
    recipientEmail: emailResult.email,
    locale: "en", // No user locale available in worker context
    reviewId,
    locationId,
    failureReason,
  });

  if (!sendResult.success) {
    logger.warn({ receiptId, reviewId, error: sendResult.error }, "Failed to send disable notification email");
  }
}
```

#### Disable Route (`app/api/admin/reviews/disable/route.ts`)

After successful disable response is determined, send email before returning:

- For `"disable"` action: resolve email via Kiyoh API using reviewId from result, get failureReason from Receipt
- For `"disable-manual"` action: resolve email via Kiyoh API using provided reviewId/tenantId, use generic failure reason `"ADMIN_DISABLED"`

## Data Model

No schema changes required. The `ReviewDisableAudit` table already tracks all necessary data. Email sending is fire-and-forget with logging only.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| SMTP_HOST | Yes | — | SMTP server hostname |
| SMTP_PORT | Yes | — | SMTP server port |
| SMTP_USER | Yes | — | SMTP auth username |
| SMTP_PASS | Yes | — | SMTP auth password |
| SMTP_FROM | Yes | — | From address with display name |
| APP_URL | Yes | — | Base URL for dispute link (e.g. `https://app.reviewreceipts.com`) |
| KIYOH_REVIEW_LIST_URL | No | `https://www.klantenvertellen.nl/v1/review` | Kiyoh review list API base URL |

`APP_URL` is needed to construct the absolute dispute link in emails. Add to `.env.example`.

## Translation Keys

New namespace `ReviewDisableEmail` in all 8 message files:

```json
{
  "ReviewDisableEmail": {
    "subject": "Your review has been disabled",
    "greeting": "Hello,",
    "body": "Your review (ID: {reviewId}) for location {locationId} has been disabled because it did not pass our verification process.",
    "reasonLabel": "Reason",
    "failureNotAReceipt": "The uploaded image was not a valid receipt",
    "failureImageUnclear": "The receipt image was too unclear to verify",
    "failureInsufficientInfo": "The receipt did not contain sufficient information",
    "failureDuplicateReceipt": "This receipt has already been submitted",
    "failureReceiptTooOld": "The receipt is too old to be accepted",
    "failureSuspectedFraud": "The receipt was flagged for suspected fraud",
    "failureUnreadableText": "The text on the receipt could not be read",
    "failureMissingKeyFields": "The receipt was missing required information",
    "failureAdminDisabled": "An administrator has disabled this review",
    "failureVerificationFailed": "The receipt did not pass verification",
    "disputeButtonText": "Dispute this decision",
    "footer": "If you believe this was a mistake, click the button above to submit a dispute."
  }
}
```

## Error Handling

- SMTP failures: logged, email skipped, disable operation unaffected
- Kiyoh API failures: logged, email skipped, disable operation unaffected
- Missing reviewer email in API response: logged as warning, email skipped
- Missing SMTP config: logged as error on first call, all subsequent sends return failure immediately

## Security Considerations

- Dispute page is public but only displays a static placeholder — no data exposure
- Reviewer email is fetched server-side and never exposed to the client
- SMTP credentials are read from env vars, never logged
- The dispute URL contains only the reviewId (not sensitive — it's a platform-assigned identifier)

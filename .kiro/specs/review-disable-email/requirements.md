# Requirements Document

## Introduction

Send notification emails to users when their review is disabled on the Kiyoh/KlantenVertellen platform. Emails are triggered after a successful disable operation across three flows: auto-disable (queue worker), manual disable by receipt (admin button), and manual disable by review ID (admin form). The recipient email is resolved from the Kiyoh review API (`GET v1/review` with reviewId filter). Emails include the verification failure reason and a dispute button linking to a placeholder dispute page. Emails must be localized using the existing next-intl translation system across all 8 supported languages.

## Glossary

- **Email_Service**: The module responsible for composing and sending notification emails via Nodemailer using the configured Gmail SMTP transport.
- **Review_Disable_Worker**: The BullMQ worker that processes auto-disable jobs from the review-disable queue after a receipt fails verification.
- **Disable_Route**: The Next.js API route handler at `/api/admin/reviews/disable` that processes manual disable requests from admins.
- **Review_API**: The Kiyoh `GET v1/review` endpoint that returns ReviewDto objects including the reviewer's email address. Requires authenticated session and accepts reviewId as a query parameter.
- **Dispute_Page**: A placeholder Next.js page at `/dispute` that will eventually allow users to contest a review disable decision. For now it renders a blank page.

## Requirements

### Requirement 1: Email Service Module

**User Story:** As a developer, I want a reusable email service module, so that review-disable notification emails can be sent from any disable flow using the existing SMTP configuration.

#### Acceptance Criteria

1. THE Email_Service SHALL send emails using Nodemailer with the SMTP transport configured via SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM environment variables.
2. THE Email_Service SHALL accept a recipient email address, a locale string, and review context data (review ID, location ID, failure reason) as input parameters, and SHALL return a result object indicating success or failure.
3. THE Email_Service SHALL render the email subject and body by interpolating the review context data into translated strings loaded from the next-intl translation system's message files for the provided locale.
4. THE email body SHALL include the verification failure reason explaining why the review was disabled.
5. THE email body SHALL include a dispute button that links to the Dispute_Page URL with the reviewId as a query parameter.
6. IF the SMTP transport fails to send an email, THEN THE Email_Service SHALL log the error using the shared logger and return a failure result without throwing an exception.
7. IF no locale is provided or the provided locale is not one of the 8 supported locales (en, nl, de, fr, es, af, xh, zu), THEN THE Email_Service SHALL use the "en" locale as a fallback.
8. IF any required SMTP environment variable (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM) is missing or empty, THEN THE Email_Service SHALL log an error and return a failure result without attempting to send.

### Requirement 2: Reviewer Email Resolution via Kiyoh API

**User Story:** As a developer, I want to resolve the reviewer's email address from the Kiyoh review API, so that the notification is sent to the actual reviewer rather than relying on potentially invalid receipt upload data.

#### Acceptance Criteria

1. THE Email_Service caller SHALL resolve the reviewer email by calling the Kiyoh `GET v1/review` endpoint with the reviewId and tenantId as query parameters, using the existing authenticated session.
2. THE response SHALL be parsed to extract the `email` field from the matching ReviewDto.
3. IF the Kiyoh API returns no results or the email field is empty/null, THEN the caller SHALL log a warning and skip email sending without affecting the disable operation.
4. IF the Kiyoh API call fails (network error, non-2xx response), THEN the caller SHALL log the error and skip email sending without affecting the disable operation.

### Requirement 3: Auto-Disable Email Notification

**User Story:** As a user, I want to receive an email when my review is automatically disabled due to a failed receipt verification, so that I am informed about the status change and can dispute it.

#### Acceptance Criteria

1. WHEN the Review_Disable_Worker successfully disables a review, THE Review_Disable_Worker SHALL resolve the reviewer email via the Kiyoh review API and send a notification email including the reviewId, locationId, and the receipt's failureReason.
2. THE Review_Disable_Worker SHALL resolve the receipt's failureReason from the Receipt record linked via the job's receiptId.
3. IF the reviewer email cannot be resolved from the Kiyoh API, THEN THE Review_Disable_Worker SHALL log a warning and skip email sending without failing the job.
4. IF the Email_Service returns a failure result, THEN THE Review_Disable_Worker SHALL log the email failure without affecting the overall job success status.
5. WHEN the Review_Disable_Worker sends a notification email, THE Review_Disable_Worker SHALL invoke the Email_Service after the audit record has been marked as successful, so that the disable operation is fully recorded before notification is attempted.

### Requirement 4: Manual Disable by Receipt Email Notification

**User Story:** As a user, I want to receive an email when an admin manually disables my review via the receipt card, so that I am informed about the status change and can dispute it.

#### Acceptance Criteria

1. WHEN the Disable_Route receives a "disable" action with a receiptId and the disableReviewByReceiptId service returns a successful result, THE Disable_Route SHALL resolve the reviewer email via the Kiyoh review API and send a notification email including the reviewId, locationId, and the receipt's failureReason.
2. THE Disable_Route SHALL resolve the receipt's failureReason from the Receipt record matching the provided receiptId.
3. IF the reviewer email cannot be resolved from the Kiyoh API, THEN THE Disable_Route SHALL log a warning and skip email sending without affecting the disable response returned to the admin.
4. IF the Email_Service returns a failure result, THEN THE Disable_Route SHALL log the email failure using the shared logger and still return a successful disable response to the admin.

### Requirement 5: Manual Disable by Review ID Email Notification

**User Story:** As a user, I want to receive an email when an admin manually disables my review via the manual form, so that I am informed about the status change and can dispute it.

#### Acceptance Criteria

1. WHEN the Disable_Route successfully processes a "disable-manual" action, THE Disable_Route SHALL resolve the reviewer email via the Kiyoh review API using the provided reviewId and tenantId, and send a notification email including the reviewId and locationId.
2. FOR manual disable actions, THE email SHALL use a generic failure reason indicating the review was disabled by an administrator, since no receipt-based failureReason is available.
3. IF the reviewer email cannot be resolved from the Kiyoh API, THEN THE Disable_Route SHALL log an informational message and skip email sending without affecting the disable response.
4. IF the Email_Service returns a failure result for a manual disable notification, THEN THE Disable_Route SHALL log the email failure and still return a successful disable response to the admin.

### Requirement 6: Email Content Localization

**User Story:** As a user, I want to receive the disable notification email in my preferred language, so that I can understand the communication.

#### Acceptance Criteria

1. THE Email_Service SHALL support all 8 project languages: en, nl, de, fr, es, af, xh, zu.
2. THE Email_Service SHALL include translation keys for the email subject, body, failure reason label, and dispute button text in all 8 language files under the messages directory, where the body template accepts interpolation variables for the review ID, location ID, and failure reason.
3. IF the provided locale parameter is a valid supported locale (one of en, nl, de, fr, es, af, xh, zu), THEN THE Email_Service SHALL render the email using translations for that locale.
4. IF the provided locale parameter is null, empty, or not a valid supported locale, THEN THE Email_Service SHALL render the email using the "en" locale as fallback.
5. THE email body SHALL include the review ID and the failure reason so the user can identify which review was affected and why.

### Requirement 7: Dispute Page Placeholder

**User Story:** As a user, I want to access a dispute page from the email, so that I can contest the review disable decision in the future.

#### Acceptance Criteria

1. THE application SHALL have a page at the `/dispute` route that accepts a `reviewId` query parameter.
2. THE Dispute_Page SHALL render a minimal placeholder indicating that the dispute system is under development.
3. THE Dispute_Page SHALL be accessible without authentication (public route).
4. THE dispute button in the email SHALL link to the Dispute_Page with the reviewId as a query parameter (e.g., `/dispute?reviewId=rev-123`).

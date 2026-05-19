# Requirements Document

## Introduction

When a receipt verification fails (verificationStatus set to "rejected"), the corresponding review on KlantenVertellen should be disabled. This prevents unverified reviews from remaining publicly visible. The feature supports both manual triggering (admin clicks a button) and automatic triggering (controlled by an environment variable). Disabling a review requires authenticating with the Kiyoh admin API using TOTP-based two-factor authentication, then calling the KlantenVertellen review active endpoint.

## Glossary

- **Kiyoh_Auth_Client**: The service responsible for authenticating with the Kiyoh admin API using username, password, and TOTP-based OTP verification to obtain a bearer token
- **Review_Disable_Service**: The service responsible for calling the KlantenVertellen API to set a review's active status to false
- **Admin_Receipts_Route**: The existing API route at `app/api/admin/receipts/route.ts` that handles receipt verification status updates
- **ReceiptSyncState**: The existing Prisma model that stores reviewId, locationId, tenantId, and receiptId FK linking to the Receipt model

## Requirements

### Requirement 1: Kiyoh Admin Authentication

**User Story:** As the system, I want to authenticate with the Kiyoh admin API using credentials and TOTP, so that I can obtain a bearer token for subsequent admin operations.

#### Acceptance Criteria

1. WHEN authentication is requested, THE Kiyoh_Auth_Client SHALL POST to `https://www.kiyoh.com/v1/authentication/login` with form-urlencoded body containing `tenantId=98`, `username` from KIYOH_ADMIN_USERNAME, and `password` from KIYOH_ADMIN_PASSWORD
2. WHEN the login response contains `requiresOtp: true`, THE Kiyoh_Auth_Client SHALL generate a TOTP code from the KIYOH_ADMIN_TOTP secret and POST to `https://www.kiyoh.com/v1/authentication/verify-otp` with form-urlencoded body containing the `otpSessionId` from the login response and the generated `otpCode`
3. WHEN OTP verification succeeds, THE Kiyoh_Auth_Client SHALL return the `hash` field from the response as the bearer token
4. IF the login or OTP verification request fails, THEN THE Kiyoh_Auth_Client SHALL log the error and throw an error with a descriptive message

### Requirement 2: Disable Review on KlantenVertellen

**User Story:** As an admin, I want to disable a review on KlantenVertellen when its receipt verification fails, so that unverified reviews are not publicly visible.

#### Acceptance Criteria

1. WHEN a review disable is requested, THE Review_Disable_Service SHALL authenticate via the Kiyoh_Auth_Client to obtain a bearer token
2. WHEN a bearer token is obtained, THE Review_Disable_Service SHALL PUT to `https://www.klantenvertellen.nl/v1/review/active` with Authorization Bearer header and JSON body containing `locationId`, `tenantId`, `reviewId`, and `active: false` sourced from the ReceiptSyncState record linked to the receipt
3. IF the disable request returns a non-success HTTP status, THEN THE Review_Disable_Service SHALL log the error including the HTTP status and response body
4. IF no ReceiptSyncState record exists for the given receipt, THEN THE Review_Disable_Service SHALL log a warning and skip the disable operation

### Requirement 3: Manual Disable Trigger

**User Story:** As an admin, I want to manually trigger a review disable after rejecting a receipt, so that I have explicit control over which reviews get disabled.

#### Acceptance Criteria

1. WHEN an admin sets a receipt's verificationStatus to "rejected" via the Admin_Receipts_Route, THE Admin_Receipts_Route SHALL return the updated receipt along with a flag indicating whether the review is eligible for disabling (has a linked ReceiptSyncState with a reviewId)
2. WHEN an admin calls a dedicated disable endpoint with a receipt ID, THE Review_Disable_Service SHALL look up the ReceiptSyncState by receiptId, authenticate, and disable the review on KlantenVertellen
3. THE disable endpoint SHALL require admin authentication and authorization

### Requirement 4: Automatic Disable on Rejection

**User Story:** As an operator, I want reviews to be automatically disabled when a receipt is rejected (if configured), so that the manual step can be eliminated when desired.

#### Acceptance Criteria

1. WHEN RECEIPT_AUTO_DISABLE_ENABLED is set to "true" and a receipt's verificationStatus is set to "rejected", THE Admin_Receipts_Route SHALL automatically invoke the Review_Disable_Service to disable the corresponding review
2. WHILE RECEIPT_AUTO_DISABLE_ENABLED is not set or set to "false", THE Admin_Receipts_Route SHALL not automatically disable reviews on rejection
3. IF the automatic disable operation fails, THEN THE Admin_Receipts_Route SHALL log the error but still return a successful response for the verification status update (the disable failure is non-blocking)

### Requirement 5: Force Disable Review

**User Story:** As an admin, I want to force-disable a review regardless of verification status, so that I can remove reviews from KlantenVertellen even when the receipt passed verification.

#### Acceptance Criteria

1. WHEN an admin calls the disable endpoint with a receipt ID, THE Review_Disable_Service SHALL disable the review on KlantenVertellen regardless of the receipt's current verificationStatus
2. THE disable endpoint SHALL not check or enforce any verificationStatus precondition before executing the disable operation
3. IF no ReceiptSyncState record exists for the given receipt, THEN THE disable endpoint SHALL return an error indicating the review cannot be disabled because no linked review data exists

### Requirement 6: Re-enable Review

**User Story:** As an admin, I want to re-enable a review that was incorrectly disabled, so that legitimate reviews can be restored on KlantenVertellen.

#### Acceptance Criteria

1. WHEN an admin calls the enable endpoint with a receipt ID, THE Review_Disable_Service SHALL authenticate via the Kiyoh_Auth_Client and PUT to `https://www.klantenvertellen.nl/v1/review/active` with `active: true` using the reviewId, locationId, and tenantId from the linked ReceiptSyncState record
2. IF the enable request returns a non-success HTTP status, THEN THE Review_Disable_Service SHALL log the error and return a failure response
3. IF no ReceiptSyncState record exists for the given receipt, THEN THE enable endpoint SHALL return an error indicating the review cannot be enabled because no linked review data exists

### Requirement 7: Manual Review Disable by Review ID

**User Story:** As an admin, I want to disable a review by directly specifying a review ID, location ID, and tenant ID, so that I can disable reviews that are not linked to any receipt in the system.

#### Acceptance Criteria

1. WHEN an admin calls the manual disable endpoint with a reviewId, locationId, and tenantId, THE Review_Disable_Service SHALL authenticate and disable the review on KlantenVertellen without requiring a linked ReceiptSyncState or Receipt record
2. THE manual disable endpoint SHALL validate that reviewId, locationId, and tenantId are all provided and non-empty
3. THE manual disable endpoint SHALL require admin authentication and authorization
4. THE admin reviews page SHALL display a form with text fields for reviewId, locationId, and tenantId, and a "Disable Review" button that invokes the manual disable endpoint

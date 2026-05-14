# Implementation Plan: Review Disable on Failed Verification

## Overview

Disable (and re-enable) reviews on KlantenVertellen when receipt verification fails. Includes Kiyoh admin authentication (login + TOTP), a review disable/enable service, automatic disable on rejection (env-var controlled), and a manual disable form on the admin reviews page.

## Tasks

- [ ] Create `lib/review-disable/kiyoh-auth-client.ts` that authenticates with the Kiyoh admin API by POSTing login credentials (form-urlencoded with tenantId=98) to get an otpSessionId, generating a TOTP code from KIYOH_ADMIN_TOTP using the `otpauth` package, and verifying the OTP to obtain a bearer token hash; add `otpauth` as a dependency. _Requirements: 1.1, 1.2, 1.3, 1.4_
- [ ] Create `lib/review-disable/review-disable-service.ts` with three functions: `disableReviewByReceiptId` (looks up ReceiptSyncState by receiptId, authenticates, PUTs active:false), `enableReviewByReceiptId` (same lookup, PUTs active:true), and `disableReviewManual` (accepts reviewId/locationId/tenantId directly, authenticates, PUTs active:false without requiring a ReceiptSyncState record). _Requirements: 2.1, 2.2, 2.3, 2.4, 5.1, 5.2, 6.1, 6.2, 6.3, 7.1_
- [ ] Create `app/api/admin/reviews/disable/route.ts` POST endpoint that accepts JSON body with action ("disable", "enable", "disable-manual"), validates input with Zod, requires admin auth, and delegates to the review-disable-service functions; return success/error JSON responses. _Requirements: 3.2, 3.3, 5.3, 7.2, 7.3_
- [ ] Extend `app/api/admin/receipts/route.ts` PATCH handler to check RECEIPT_AUTO_DISABLE_ENABLED env var when verificationStatus is set to "rejected", and fire-and-forget call `disableReviewByReceiptId` (log errors but do not block the response); also return a `canDisableReview` flag indicating whether a linked ReceiptSyncState exists. _Requirements: 3.1, 4.1, 4.2, 4.3_
- [ ] Add a collapsible "Handmatig review uitschakelen" form to `app/admin/reviews/page.tsx` with text inputs for reviewId, locationId, tenantId (default 98) and a "Disable Review" button that calls the disable endpoint; add all user-visible strings to the 8 translation files under a "ReviewDisable" namespace. _Requirements: 7.1, 7.4_
- [ ] Create `tests/services/review-disable-service.test.ts` with unit tests covering: kiyoh-auth-client (login + OTP flow, error handling), review-disable-service (disable by receiptId, enable by receiptId, manual disable, missing ReceiptSyncState handling), and the disable route handler (auth checks, action dispatch, auto-disable fire-and-forget behavior); mock fetch and Prisma. _Requirements: 1.1–1.4, 2.1–2.4, 4.1–4.3, 5.1–5.3, 6.1–6.3_

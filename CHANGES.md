# Changes

## [117] Add dispute_received notification type

**What**: Added a new `dispute_received` notification type that fires when a customer submits a dispute, separate from the existing `dispute_outcome` type.
**Why**: Admins need to know immediately when a dispute comes in, not just after it's been processed.
**Files**:
- lib/services/notification-service.ts
- app/api/dispute/verify/route.ts
- messages/*.json (all 8 languages)

## [116] Separate requires_review from pending in volume analytics chart

**What**: Added a distinct `requiresReview` field to volume data points so receipts awaiting human review no longer inflate the "pending" count in the analytics chart.
**Why**: The catch-all `pending = total - verified - rejected` was including `requires_review` receipts, making it look like unprocessed receipts existed when all had actually been handled by AI.
**Files**:
- lib/services/analytics-service.ts
- app/admin/analytics/page.tsx
- tests/services/analytics-service.test.ts
- messages/*.json (all 8 languages)

## [115] Fix "Load More" in human review section resetting list back to page 1

**What**: Moved the cursor for review-required pagination into a ref so the `fetchReviewRequired` callback identity stays stable and doesn't trigger the initial-load effect on every page fetch.
**Why**: `reviewRequiredCursor` in the `useCallback` dep array caused the callback to be recreated on each load, which cascaded into the auth-status effect calling `fetchReviewRequired(true)` (a reset).

## [114] Fix mention notifications leaking to all users instead of only the mentioned user

**What**: Added `userId` field to the Notification model so mention notifications are targeted to the specific mentioned user rather than broadcast globally.
**Why**: The notification system was originally designed for global broadcasts only — when comment mentions were added, they reused the same global path, causing all users (including admin) to see every mention notification.
**Decisions**:
- `userId` is nullable — null means global (existing behavior for system notifications)
- `getNotifications` and `getUnreadCount` now filter: show global (userId=null) + user-targeted notifications
- Email delivery for targeted notifications only checks the target user's preference, not all users
**Files**:
- prisma/schema.prisma
- prisma/migrations/20260601000008_add_user_id_to_notification/migration.sql
- lib/services/notification-service.ts
- lib/services/comment-service.ts
- app/api/notifications/route.ts

## [113] Fix missing messages directory in Docker images breaking email translations and dispute URLs

**What**: Added `COPY --from=builder /app/messages ./messages` to all Docker targets (production, worker, staging) so email translations resolve at runtime instead of falling back to raw keys.
**Why**: The `email-translations.ts` reads JSON files from `messages/` via `process.cwd()` — without the directory in the image, all translations silently fall back to key names.
**Decisions**:
- Also affects the standalone `Dockerfile.worker`
- The broken dispute URL (`http:///dispute`) is a separate env issue — `APP_URL` must be set on the staging worker service
**Files**:
- Dockerfile
- Dockerfile.worker

## [112] Wire audit logs into receipt activity timeline

**What**: Merged existing audit log entries for a receipt into the comment thread as a unified activity timeline, showing both comments and system events chronologically.
**Decisions**:
- Added `getAuditLogsForReceipt` that filters by receiptId inside metadata JSON
- Reused CommentThread component rather than creating a separate one — audit entries render with distinct system-event styling
- Header changed from "Comments" to "Activity" to reflect the combined timeline
**Files**:
- lib/services/audit-log-service.ts
- app/api/receipts/[id]/activity/route.ts (new)
- components/comment-thread.tsx
- messages/*.json (all 8 languages)

## [111] Fix build failure from env var validation at module load time

**What**: Replaced throwing helper functions for GOOGLE_CLIENT_ID/SECRET with fallback empty strings so `next build` doesn't crash when env vars aren't available at build time (Railway injects them at runtime only).
**Files**:
- lib/auth-options.ts

## [110] Fix admin dashboard bugs: disputes badge, comment thread, access control

**What**: Added badge count to Disputes tab, added CommentThread to dispute modal, removed user-scoping from receipt list/view/download so all authenticated users can access all receipts.
**Decisions**:
- Disputes badge counts items with status "pending" or "requires_review"
- Only `/admin/settings` retains admin-role guard; all other routes are open to any authenticated user
**Files**:
- app/admin/page.tsx
- lib/services/receipt-service.ts
- tests/services/receipt-service.test.ts
- tests/routes/receipts.test.ts

## [109] Fix review findings from 26.05.20.1-feature-sprint

**What**: Fixed SMTP password exposure in settings API, remediated 30+ banned code patterns (ternaries, magic values, abbreviations, console.error, chained ops), added missing translations, restored admin auth guard, added limit caps and JSON parse guards on API routes.
**Decisions**:
- Created `lib/client-logger.ts` for browser-side structured logging (pino is server-only)
- Used `getFraudRiskColorClass` helper to eliminate repeated fraud score ternaries
- Relative time functions now accept translation objects to eliminate hardcoded strings
**Files**:
- app/api/admin/settings/route.ts
- app/api/admin/disputes/route.ts
- app/api/admin/receipts/review-required/route.ts
- app/admin/page.tsx
- app/admin/analytics/page.tsx
- components/comment-thread.tsx
- components/notification-bell.tsx
- components/mention-autocomplete.tsx
- lib/client-logger.ts (new)
- messages/*.json (all 8 languages)

## [108] Complete Google SSO for login and signup

**What**: Added Google sign-up button to signup page, removed drive.readonly scope (login-only needs profile+email), added startup validation for Google OAuth env vars, removed accessToken from session.
**Decisions**:
- Env var validation uses lazy functions (called at module evaluation) to fail fast in production but allow test env override via vitest config
- Kept `refreshGoogleToken` in auth-service as dead code for now (separate cleanup)
- Used `allowDangerousEmailAccountLinking: true` so existing email/password users can link Google seamlessly
**Files**:
- lib/auth-options.ts
- app/signup/page.tsx
- vitest.config.ts
- .env.example
- messages/*.json (all 8 languages)

## [107] Add comment thread UI with @-mention autocomplete

**What**: Built CommentThread and MentionAutocomplete components, integrated into admin receipt detail modal, added Comments translation keys to all 8 locale files.
**Decisions**:
- Used custom useMentionInput hook for shared mention logic between compose and edit modes
- Positioned autocomplete dropdown using fixed positioning relative to textarea
- Comment thread placed below download button in receipt detail panel
**Files**:
- components/comment-thread.tsx
- components/mention-autocomplete.tsx
- app/admin/page.tsx
- messages/en.json, nl.json, de.json, fr.json, es.json, af.json, xh.json, zu.json

## [106] Add unit tests for comment-service

**What**: Added 22 unit tests covering createComment validation, editComment authorization and new-mention notifications, deleteComment authorization, and getComments ordering and deserialization.

## [105] Add comment and user search API routes

**What**: Created API routes for comment CRUD (GET/POST on receipts/[id]/comments, PATCH/DELETE on comments/[commentId]) and user search endpoint for @-mention autocomplete.
**Decisions**:
- Thin route handlers delegating to comment-service
- User search uses Prisma directly (no service layer needed for simple query)
**Files**:
- app/api/receipts/[id]/comments/route.ts
- app/api/receipts/[id]/comments/[commentId]/route.ts
- app/api/users/search/route.ts

## [104] Add comment service with CRUD and mention notifications

**What**: Created `lib/services/comment-service.ts` with createComment, getComments, editComment, and deleteComment functions including body validation, author-only edit, author-or-admin delete, and fire-and-forget mention notifications for new and newly-added mentions.

## [103] Add Comment model and comment_mention notification type

**What**: Added Prisma Comment model with indexes and cascade relations to User/Receipt, added `comment_mention` to the notification type system.
**Files**:
- prisma/schema.prisma
- prisma/migrations/20260520121706_add_comment_model/migration.sql
- lib/services/notification-service.ts

## [102] Add manual review disable/enable form to admin page

**What**: Added a "Manual Disable" tab to the admin dashboard with a form for review ID, location ID, and tenant ID that calls the existing `disable-manual`/`enable-manual` API actions.
**Why**: Restores the previously removed manual testing form for directly disabling/enabling reviews on the platform.
**Files**:
- app/admin/page.tsx
- messages/*.json (all 8 languages)

## [101] Move SMTP configuration from env vars to admin settings page

**What**: SMTP settings (host, port, user, pass, from) are now configurable via the admin settings page with DB persistence, falling back to env vars if not set in the database.
**Decisions**:
- Reused existing `AppSetting` key-value table — no migration needed
- Both email-service and notification-service now read SMTP config via `getSmtpSettings()` (DB-first, env fallback)
- Removed singleton transport pattern in email-service since settings can change at runtime
**Files**:
- lib/services/app-settings-service.ts
- lib/services/notification-service.ts
- lib/email/email-service.ts
- app/api/admin/settings/route.ts
- app/admin/settings/page.tsx
- messages/*.json (all 8 languages)
- tests/services/email-service.test.ts
- tests/services/app-settings-service.test.ts
- tests/routes/admin-settings.test.ts

## [100] Add date range picker and scrollable chart to analytics volume tab

**What**: Volume chart now supports custom date ranges via date inputs and quick presets (Today, Last 7 days, Last 30 days). Chart is horizontally scrollable when many data points are shown. Service accepts optional `startDate`/`endDate` and computes bucket count dynamically.
**Decisions**:
- "Today" preset auto-switches to hourly granularity for the most useful view
- Chart container uses `overflow-x-auto` with a min-width based on data point count
- X-axis labels rotate at 45° when more than 14 bars to prevent overlap
**Files**:
- lib/services/analytics-service.ts
- app/api/admin/analytics/route.ts
- app/admin/analytics/page.tsx
- messages/*.json (all 8 languages)
- tests/services/analytics-service.test.ts

## [099] Replace dashboard metrics with review-required list and add disputes tab

**What**: Removed stat cards from admin dashboard top, replaced with scrollable list of `requires_review` receipts with time range filtering and cursor pagination. Replaced "Statistics" tab with "Disputes" tab showing all `ReceiptDispute` records with receipt preview modal and accept/reject actions.
**Decisions**:
- New API endpoint `/api/admin/receipts/review-required` with cursor pagination and date filtering
- New API endpoint `/api/admin/disputes` (GET + PATCH) for listing and actioning disputes
- Dispute accept/reject updates both `ReceiptDispute.status` and linked `Receipt.verificationStatus` in a transaction
- Reused existing receipt download endpoint for dispute receipt previews (disputes store receipts in the same R2 bucket)
**Files**:
- app/admin/page.tsx
- app/api/admin/disputes/route.ts (new)
- app/api/admin/receipts/review-required/route.ts (new)
- messages/*.json (all 8 languages)

## [098] Add notification system with bell dropdown, preferences, and email delivery

**What**: Added global notification feed with bell icon in header (unread badge, dropdown list, mark-all-read), per-user notification preferences on the `/settings` page (none/in-app/email per notification type), and email delivery via existing SMTP for users who opt in.
**Decisions**:
- Global `Notification` table (no userId) — all users see the same feed
- Unread tracking via `lastNotificationReadAt` timestamp on User (option B — simpler than per-user read state)
- `NotificationPreference` table stores per-user channel choice per notification type
- Email delivery uses existing SMTP config (nodemailer) with a simple HTML template
- 5 notification types: receipt_requires_review, receipt_processed, review_disabled, dispute_outcome, role_changed
- Fire-and-forget pattern consistent with audit log service
**Files**:
- prisma/schema.prisma
- prisma/migrations/20260601000007_add_notifications/migration.sql
- lib/services/notification-service.ts (new)
- app/api/notifications/route.ts (new)
- app/api/notifications/preferences/route.ts (new)
- components/notification-bell.tsx (new)
- components/header.tsx
- app/settings/page.tsx
- messages/*.json (all 8 languages)

## [097] Fix review findings for analytics feature

**What**: Resolved all 14 banned pattern violations and 1 localization issue from code review 26.05.20-analytics.
**Decisions**:
- Extracted time constants (`MILLISECONDS_PER_SECOND`, `SECONDS_PER_MINUTE`, etc.) and `PERCENTAGE_MULTIPLIER` in analytics-service
- Extracted `RECEIPT_ID_PREVIEW_LENGTH` constant for `slice(0, 8)` calls
- Replaced `buildSummary` hardcoded English strings with `t()` calls using new translation keys (`summaryReceiptVerdict`, `summaryRoleChanged`, `summaryUpdated`, `summaryReceipt`)
- Added translation keys to all 8 locale files
**Files**:
- lib/services/analytics-service.ts
- app/admin/analytics/page.tsx
- app/api/admin/analytics/route.ts
- messages/en.json, nl.json, de.json, fr.json, es.json, af.json, xh.json, zu.json

## [096] Build AuditLogTab component with category filters, table, and pagination

**What**: Replaced the placeholder audit log tab in the analytics page with a full implementation featuring category filter pills, a data table, cursor-based pagination, loading spinner, and empty state.
**Decisions**:
- Used separate `AuditLog` translation namespace to keep keys organized
- Category badge colors map to distinct Tailwind color classes per category
- Summary column derives human-readable text from metadata JSON
- Silent error handling in fetch (matching existing page pattern for client-side code)
**Files**:
- app/admin/analytics/page.tsx
- messages/en.json, nl.json, de.json, fr.json, es.json, af.json, xh.json, zu.json

## [095] Add unit tests for audit-log-service

**What**: Unit tests covering writer error isolation (fire-and-forget, error logging), cursor-based pagination, and category filtering.

## [094] Rename admin settings nav link to "Admin" and add user settings placeholder

**What**: Renamed admin settings link label from "Settings" to "Admin" in header navigation, added a new "Settings" link visible to all authenticated users pointing to `/settings`, and created a placeholder settings page.
**Decisions**:
- Used `Shield` icon for admin link to visually distinguish from user settings
- Created `UserSettings` namespace to avoid conflict with existing `Settings` namespace (admin settings page)
**Files**:
- components/header.tsx
- app/settings/page.tsx
- messages/en.json, nl.json, de.json, fr.json, es.json, af.json, xh.json, zu.json
- tests/pages/header-navigation.test.tsx

## [093] Add recordAuditEvent calls to all integration points

**What**: Integrated fire-and-forget audit logging into OCR service, receipt service, admin reviews disable route, admin service, settings route, receipt worker, receipt creator, and dispute verify route.
**Decisions**:
- Added `adminId` parameter to `updateUserRole` (optional, threaded from calling route)
- Used `(session.user as any).id` pattern consistent with existing codebase for session user ID access
- Mocked audit-log-service in affected test files since fire-and-forget calls don't need testing in route tests
**Files**:
- lib/services/ocr-service.ts
- lib/services/receipt-service.ts
- app/api/admin/reviews/disable/route.ts
- lib/services/admin-service.ts
- app/api/admin/users/route.ts
- app/api/admin/settings/route.ts
- lib/queue/receipt-worker.ts
- lib/receipt-sync/receipt-creator.ts
- app/api/dispute/verify/route.ts
- tests/routes/admin.test.ts
- tests/routes/receipts.test.ts
- tests/routes/admin-settings.test.ts

## [092] Extend analytics route with type=audit handler

**What**: Added `type=audit` query param support to the analytics API route, delegating to `getAuditLogs` with optional `category` and `cursor` params.
**Decisions**:
- Validates category against allowed values before querying
- Replaced `console.error` with shared logger in catch block
- Extracted `handleAuditQuery` helper to keep the route handler thin

## [091] Add AuditLog model and audit-log-service with fire-and-forget writer and cursor-based query

**What**: Added `AuditLog` Prisma model with composite indexes and created `lib/services/audit-log-service.ts` with `recordAuditEvent` (fire-and-forget, internal error logging) and `getAuditLogs` (cursor-based pagination, category filtering).
**Decisions**:
- No foreign key on actorId — entries survive user deletion
- Writer catches errors internally via shared logger, never propagates
- Query fetches limit+1 to determine hasMore without a separate count query
**Files**:
- prisma/schema.prisma
- prisma/migrations/20260601000006_add_audit_log/migration.sql
- lib/services/audit-log-service.ts

## [090] Show queued/processed dates in admin table, move user/date/amount to modal

**What**: Replaced User, Date, and Amount columns in the admin review queue table with Queued and Processed timestamp columns. The removed data is already visible in the receipt detail modal.

## [089] Add queuedAt timestamp to Receipt model

**What**: Track when a receipt is pulled into the processing queue via a new `queuedAt` field, complementing the existing `processedAt` timestamp. Display both timestamps on user and admin receipt cards.
**Files**:
- prisma/schema.prisma
- prisma/migrations/20260520000000_add_queued_at_to_receipt/migration.sql
- lib/queue/receipt-queue.ts
- lib/services/receipt-service.ts
- components/receipt-card.tsx
- components/admin-receipt-card.tsx
- app/admin/page.tsx
- messages/*.json (all 8 languages)
- tests/routes/receipts.test.ts
- tests/routes/admin.test.ts
- tests/services/ocr-service.test.ts
- tests/services/receipt-service.test.ts

## [088] Add analytics page with metrics, volume chart, and audit log tab

**What**: Added admin-only analytics page at `/admin/analytics` with three tabs: metrics overview (receipt counts, approval/rejection rates), receipt volume stacked bar chart (filterable by hour/day/week using Recharts), and a placeholder audit log tab for future implementation.
**Decisions**:
- Used Recharts for the volume chart (already installed, simplest React integration)
- Analytics service separates data logic from the API route
- Volume query fetches all receipts in range and buckets client-side (sufficient for current scale)
- Audit log tab is an empty placeholder per requirements
**Files**:
- lib/services/analytics-service.ts (new)
- app/api/admin/analytics/route.ts (new)
- app/admin/analytics/page.tsx (new)
- components/header.tsx
- messages/*.json (all 8 languages)
- tests/services/analytics-service.test.ts (new)
- tests/pages/header-navigation.test.tsx

## [087] Fix review findings from 26.05.19 code review

**What**: Applied all 10 standards fixes (ternaries → if-else, short-circuits → if-else, chained ops → separate lines, magic numbers → named constants) and 3 security fixes (admin-gate settings nav link, Zod schema validation on secondary analysis LLM output, type guard on parsed verdict).
**Decisions**:
- Confidence thresholds extracted to `CONFIDENCE_HIGH_THRESHOLD` / `CONFIDENCE_MEDIUM_THRESHOLD` constants with helper functions
- Zod schema replaces manual verdict-only check in `runSecondaryAnalysis`, validating all fields including confidence range 0-100
- Settings link in header gated on `role === "admin"` (both desktop and mobile)
- Updated header navigation tests to reflect admin-only settings visibility
**Files**:
- app/admin/page.tsx
- app/api/receipts/[id]/ocr/route.ts
- lib/services/ocr-service.ts
- lib/services/dispute-service.ts
- app/admin/settings/page.tsx
- components/header.tsx
- lib/queue/receipt-worker.ts
- tests/pages/header-navigation.test.tsx

## [086] Add confidence column to review queue table

**What**: Added OCR confidence value as a column before the risk column in the admin review queue table.
**Files**: `app/admin/page.tsx`, `messages/*.json` (all 8 languages)

## [085] Simplify confidence logic to single threshold with secondary analysis on all uncertain outcomes

**What**: Replaced the two-threshold system (high/low) with a single confidence threshold. Receipts meeting the threshold with no failure indicators auto-verify; everything else goes through secondary analysis. Removed auto-reject on low confidence.
**Why**: Low confidence on a pass was incorrectly auto-rejecting receipts. Confidence should indicate whether to trust the model's judgment, not determine the outcome directly.
**Decisions**:
- Single threshold gate: ≥ threshold + no failure + readable + fields = verified; everything else = requires_review
- Secondary analysis runs on ALL non-verified, non-hard-rule outcomes (not just rejections)
- Hard rules (duplicate, date too old) still reject immediately without secondary analysis
- Auto-disable triggers on hard-rule rejections (bypass secondary confirmation) and secondary-confirmed rejections
- Removed `getLowConfidenceThreshold`, `SETTING_LOW_CONFIDENCE_THRESHOLD`, and all low threshold UI/translations
- Updated secondary prompt to handle uncertain results (not just rejections)
**Files**:
- lib/services/ocr-service.ts
- lib/services/app-settings-service.ts
- lib/services/dispute-service.ts
- lib/queue/receipt-worker.ts
- app/api/receipts/[id]/ocr/route.ts
- app/api/admin/settings/route.ts
- app/admin/settings/page.tsx
- messages/*.json (all 8 languages)
- tests/services/ocr-service.test.ts
- tests/services/app-settings-service.test.ts
- tests/routes/admin-settings.test.ts

## [084] Give secondary analysis authority to overwrite verification status and OCR values

**What**: Secondary analysis now returns a structured verdict (confirmed_rejection, overturned_to_verified, requires_review) with its own OCR extraction values and confidence score, which overwrite the initial analysis and re-apply confidence threshold logic.
**Decisions**:
- Secondary analysis prompt updated to extract its own shop name, date, amount, confidence, and readable flag
- Verdict drives final status: confirmed keeps rejection, overturned/requires_review re-runs `determineVerificationStatus` with secondary values
- `secondaryAnalysis` DB field now stores JSON (with legacy string fallback in worker)
- Auto-disable only triggers on `confirmed_rejection` verdict
- Applied consistently across all three OCR paths (worker, streaming route, dispute verify)
**Files**: `lib/services/ocr-service.ts`, `lib/queue/receipt-worker.ts`, `app/api/receipts/[id]/ocr/route.ts`, `lib/services/dispute-service.ts`, `app/api/dispute/verify/route.ts`, `components/receipt-card.tsx`

## [083] Fix blank page on reload and add receipt queue auto-refresh

**What**: Removed the `mounted` state guard in `Providers` that hid the entire app tree before hydration, and added 15-second polling to the admin receipts queue.
**Why**: The mounted guard caused a blank page when session resolution raced with the visibility toggle; the queue had no mechanism to show new receipts without a manual reload.
**Decisions**:
- `next-themes` already handles hydration internally — the external mounted guard was redundant
- 15s polling interval balances freshness with network cost
**Files**: `components/providers.tsx`, `app/admin/page.tsx`

## [082] Add auto-disable location whitelist

**What**: Added a location whitelist setting that restricts auto-disable to specific location IDs only (requires auto-disable to be enabled as prerequisite)
**Decisions**:
- Stored as JSON string array in `AppSetting` table (same pattern as other settings)
- Empty whitelist means all locations are allowed (backwards-compatible default)
- Whitelist check applied in both `receipt-worker` and `admin/receipts` auto-disable paths
- UI section only visible when auto-disable toggle is on
**Files**: `lib/services/app-settings-service.ts`, `app/api/admin/settings/route.ts`, `lib/queue/receipt-worker.ts`, `app/api/admin/receipts/route.ts`, `app/admin/settings/page.tsx`, `messages/*.json`, `tests/services/app-settings-service.test.ts`, `tests/routes/admin-settings.test.ts`

## [081] Add confidence threshold settings to admin settings page

**What**: Added configurable high/low confidence thresholds to the settings page and wired them into the OCR verification logic. Thresholds are stored in the `AppSetting` table with defaults of 70 (auto-verify) and 30 (auto-reject).
**Decisions**:
- `determineVerificationStatus` accepts optional thresholds parameter, defaults to module constants when not provided
- `processReceiptOcr` reads thresholds from DB at call time; streaming OCR route and dispute route use defaults (can be wired later if needed)
- Input validated server-side: must be number between 0-100
**Files**: `lib/services/app-settings-service.ts`, `lib/services/ocr-service.ts`, `app/api/admin/settings/route.ts`, `app/admin/settings/page.tsx`, `tests/services/app-settings-service.test.ts`, `tests/routes/admin-settings.test.ts`, `messages/*.json`

## [080] Add auto-verify and auto-disable toggles to admin settings page

**What**: Added toggle switches to the admin settings page for controlling auto-verify (synced receipts) and auto-disable (rejected reviews) features, backed by a new `AppSetting` database table.
**Decisions**:
- DB-backed settings with env var fallback — toggles override env vars when set
- Consumers (`receipt-worker`, `receipt-creator`, `admin/receipts` route) now read from DB at call time
**Files**: `prisma/schema.prisma`, `prisma/migrations/20260601000005_add_app_setting/`, `lib/services/app-settings-service.ts`, `app/api/admin/settings/route.ts`, `app/admin/settings/page.tsx`, `lib/queue/receipt-worker.ts`, `lib/receipt-sync/receipt-creator.ts`, `app/api/admin/receipts/route.ts`, `messages/*.json`

## [079] Handle pre-existing database migration failures in entrypoint

**What**: Updated docker-entrypoint.sh to handle P3018 (relation already exists) and P3009 (previously failed migration) in addition to P3005, so deploys to environments with pre-existing tables recover automatically.
**Why**: Deploying to an old environment whose tables predate Prisma migrations caused an unrecoverable failed-migration state.
**Files**: `scripts/docker-entrypoint.sh`

## [078] Add unit tests for navigation consolidation

**What**: Added unit tests covering settings page auth redirects and role update fetch calls, dashboard redirect behavior, and header navigation link rendering for authenticated/unauthenticated users.
**Files**: `tests/pages/settings-page.test.ts`, `tests/pages/dashboard-redirect.test.ts`, `tests/pages/header-navigation.test.tsx`

## [077] Update all 8 message files for navigation consolidation

**What**: Removed `Moderation`, `Reviews`, `ReviewDisable`, `Automation` namespaces; updated `Header` to remove `adminPanel`/`moderation`/`platforms`; changed `Admin.title` to "Dashboard" (translated); removed user-management keys from `Admin`; ensured `Settings` namespace has all required keys.
**Files**: `messages/en.json`, `messages/nl.json`, `messages/de.json`, `messages/fr.json`, `messages/es.json`, `messages/af.json`, `messages/xh.json`, `messages/zu.json`

## [076] Create admin settings page with user management

**What**: Created `app/admin/settings/page.tsx` with admin-only auth check and user management UI (role dropdown per user, fetching from `/api/admin/users`). Added `Settings` translation namespace to all 8 language files.
**Files**: `app/admin/settings/page.tsx`, `messages/en.json`, `messages/nl.json`, `messages/de.json`, `messages/fr.json`, `messages/es.json`, `messages/af.json`, `messages/xh.json`, `messages/zu.json`

## [075] Simplify admin page: remove users tab, ManualDisableForm, add Reason column

**What**: Removed the "users" tab and ManualDisableForm from the admin page, keeping only queue and stats tabs. Added a "Reason" column to the receipt queue table showing `failureReason` (dash when empty).
**Files**: `app/admin/page.tsx`

## [074] Replace user dashboard with redirect to /admin

**What**: Replaced the entire user dashboard page with a server component that redirects to `/admin`, ensuring existing bookmarks continue to work.
**Files**: `app/dashboard/page.tsx`

## [073] Consolidate header navigation to Dashboard and Settings

**What**: Replaced 4 admin nav links with 2 (Dashboard → `/admin`, Settings → `/admin/settings`) for all authenticated users, removing admin-only gating.
**Files**: `components/header.tsx`, `messages/en.json`, `messages/nl.json`, `messages/de.json`, `messages/fr.json`, `messages/es.json`, `messages/af.json`, `messages/xh.json`, `messages/zu.json`

## [072] Remove moderation, platforms, and automation features

**What**: Deleted all moderation, platforms, and automation code — pages, API routes, service layer, executor, and tests — and dropped the AutomationWorkflow table via Prisma migration.
**Files**: `app/admin/moderation/`, `app/admin/platforms/`, `app/admin/settings/automation/`, `app/api/reviews/`, `app/api/admin/automation/`, `lib/automation/`, `lib/services/automation-service.ts`, `tests/routes/automation.test.ts`, `tests/routes/reviews.test.ts`, `tests/services/automation-service.test.ts`, `prisma/schema.prisma`, `prisma/migrations/20260601000004_drop_automation_workflow/`

## [071] Fix review findings for email-notification-on-disable branch

**What**: Resolved all 22 standards violations (ternaries → if-else, short-circuits → explicit assignments, magic values → named constants), 2 security issues (pinned @types/nodemailer, escaped HTML in email intro), and 4 stability issues (race condition via upsert, wrapped response.text() in try-catch, added env var startup validation, added Zod schemas to 3 dispute API routes).
**Decisions**:
- Used `upsert` for `getOrCreateDisputeUserId` to eliminate race condition
- Startup validation for `DISPUTE_TOKEN_SECRET`/`NEXTAUTH_SECRET` exits the worker process; `APP_URL` only warns
- Dispute page narrowed `token` with an explicit null-check early return instead of non-null assertion
**Files**: `components/dispute-uploader.tsx`, `lib/email/email-service.ts`, `lib/email/email-translations.ts`, `lib/email/email-templates.ts`, `lib/review-disable/kiyoh-review-client.ts`, `lib/queue/review-disable-worker.ts`, `lib/services/dispute-service.ts`, `lib/s3.ts`, `app/dispute/page.tsx`, `app/api/admin/reviews/disable/route.ts`, `app/api/dispute/upload/route.ts`, `app/api/dispute/verify/route.ts`, `app/api/dispute/request-review/route.ts`, `scripts/queue-worker.ts`, `package.json`

## [070] Redesign rejection email with branded card-based template

**What**: Replaced the plain-text-style rejection email with a card-based HTML template matching the Kiyoh/Klantenvertellen brand guidelines — banner image, logo, requirement bullets, dispute CTA, and branded footer with terms link and support email.
**Decisions**:
- Added `email-brand.ts` to resolve tenant-aware branding (logo, terms URL, support email) from `tenantId`
- Logos served from `/public` via absolute APP_URL paths so email clients can fetch them
- Template uses `{guidelinesLink}` placeholder in the `intro` translation key, interpolated at render time with the brand's terms URL
- Installed `@types/nodemailer` to fix pre-existing type error
**Files**: `lib/email/email-brand.ts`, `lib/email/email-templates.ts`, `lib/email/email-translations.ts`, `lib/email/email-service.ts`, `tests/services/email-service.test.ts`, `messages/*.json` (all 8)

## [069] Sign dispute links and link disputes to reviews via ReceiptDispute table

**What**: Replaced the raw `?reviewId=` dispute query string with a signed token (HMAC-SHA256, 30-day expiry) carrying reviewId, tenantId, locationId, and failureReason. Added a `ReceiptDispute` table joining each dispute receipt to its originating review, persisted on every verified dispute. Email service builds and sends the signed link; the dispute page and all three API routes verify the token and reject expired/tampered links.
**Decisions**:
- Token format: `base64url(json).base64url(hmacSha256)`. Signing secret reads `DISPUTE_TOKEN_SECRET`, falls back to `NEXTAUTH_SECRET` so existing deployments keep working until the dedicated secret is set.
- `ReceiptDispute` keeps both rows (original synced receipt + dispute receipt) and stays queryable by `reviewId`. `ReceiptSyncState.receiptId` is intentionally untouched so the original rejection audit trail remains.
- The dispute page renders an "invalid/expired link" state with localized copy in all 8 locales when the token is missing, malformed, signature-mismatched, or expired.
- API routes use a small `resolveDisputeToken` helper that maps token errors to clean HTTP responses (400 missing, 401 invalid, 410 expired, 500 missing-secret).
- `requestHumanReview` now requires the token's reviewId to match the dispute record before flipping status, preventing cross-receipt review escalation with a stale token.
- `sendReviewDisableEmail` gained a required `tenantId` param so the token can be issued at send time. Both callers (admin disable route and review-disable worker) already had it available.
**Files**: `lib/dispute/dispute-token.ts`, `lib/dispute/dispute-token-http.ts`, `lib/email/email-service.ts`, `lib/services/dispute-service.ts`, `app/dispute/page.tsx`, `components/dispute-uploader.tsx`, `app/api/dispute/upload/route.ts`, `app/api/dispute/verify/route.ts`, `app/api/dispute/request-review/route.ts`, `app/api/admin/reviews/disable/route.ts`, `lib/queue/review-disable-worker.ts`, `prisma/schema.prisma`, `prisma/migrations/20260601000003_add_receipt_dispute/migration.sql`, `tests/services/dispute-token.test.ts`, `tests/services/email-service.test.ts`, `messages/*.json` (all 8), `.env.example`

## [068] Add receipt dispute page with live verification and human review fallback

**What**: Replaced the `/dispute` placeholder with a full upload + live verification flow. Users land on `/dispute?reviewId=...`, follow on-page guidance, upload a receipt to Cloudflare R2 via a dispute-scoped presigned URL, and get an instant OCR + fraud verdict. Verified receipts are persisted as if pulled normally; rejected ones expose a "Request human review" button that flips status to `requires_review`.
**Decisions**:
- Three new public route handlers under `app/api/dispute/*` (upload, verify, request-review). No auth — links arrive from outbound disable emails. Inputs validated at the boundary.
- Storage uses the existing Cloudflare-prefixed env vars via `lib/s3.ts` (`generateDisputePresignedUploadUrl` writes to `disputes/<reviewId>/...`).
- Dispute receipts attach to a dedicated `disputes@receipt-sync.internal` system user so they sit alongside synced receipts in admin views without polluting real user accounts. Dispute origin is recorded in `ocrReasoning` (`dispute_for_review:<id>`).
- Verification reuses `lib/services/ocr-service` and `lib/fraud-detection`; the route adapts those to a small `DisputeOcrAdapter` to keep `dispute-service.ts` framework-free.
- 8 locale files updated with the new `Dispute` namespace keys.
**Files**: `app/dispute/page.tsx`, `components/dispute-uploader.tsx`, `lib/services/dispute-service.ts`, `lib/s3.ts`, `app/api/dispute/upload/route.ts`, `app/api/dispute/verify/route.ts`, `app/api/dispute/request-review/route.ts`, `messages/*.json` (all 8)

## [067] Fix PDF rendering crash from mismatched @napi-rs/canvas versions

**What**: Stopped creating our own canvas via the top-level `@napi-rs/canvas` v1.0.0. Now uses `pdfDocument.canvasFactory` (backed by pdfjs-dist's nested v0.1.100 copy) so the canvas, context, and `Path2D` instances all come from the same native binding.
**Why**: pdfjs-dist v5 bundles its own `@napi-rs/canvas@0.1.100`. When we created a canvas from the top-level v1.0.0, pdfjs's internal `Path2D` objects (from v0.1.100) were rejected by the v1.0.0 context's NAPI binding with `Value is none of these types 'String', 'Path'`. Also switched from `file://` URL strings to plain absolute paths for `standardFontDataUrl`/`cMapUrl` because Node's `fs.readFile` doesn't accept `file://` strings.
**Decisions**:
- Use `pdfDocument.canvasFactory.create()` instead of importing `createCanvas` directly
- Pass raw filesystem paths (not `file://` URLs) for font/cmap directories
- Removed `@napi-rs/canvas` import from this module entirely
**Files**: `lib/pdf-to-image.ts`

## [066] Fix PDF conversion failure caused by useSystemFonts in Alpine

**What**: `convertPdfToImages` no longer asks pdfjs-dist to use system fonts. Standard fonts and CMaps are now resolved from the bundled `pdfjs-dist` package via `file://` URLs.
**Why**: With `useSystemFonts: true`, pdfjs-dist's Node font factory ended up passing an undefined font path into a NAPI binding, producing the cryptic runtime error `Value is none of these types 'String', 'Path'` and aborting every PDF receipt job in the worker (Alpine has no system fonts/fontconfig).
**Decisions**:
- Resolve `pdfjs-dist/package.json` at module load via `createRequire(import.meta.url)` so the same code works under both Next.js and the tsx worker
- Pass `standardFontDataUrl`, `cMapUrl`, and `cMapPacked: true` so embedded text in receipts still renders correctly
**Files**: `lib/pdf-to-image.ts`

## [065] Fix Kiyoh review email resolution to match actual API

**What**: Updated `resolveReviewerEmail` to pass `locationId`, parse bare-array response, and derive base URL from tenantId (98→kiyoh.com, 99→klantenvertellen.nl).
**Decisions**:
- `locationId` added as required parameter (all callers already had it available)
- Response parsed as `[{ email, ... }]` array instead of `{ reviews: [...] }` wrapper
- `KIYOH_REVIEW_LIST_URL` env var still works as override but is no longer required
**Files**: `lib/review-disable/kiyoh-review-client.ts`, `app/api/admin/reviews/disable/route.ts`, `lib/queue/review-disable-worker.ts`, `tests/services/kiyoh-review-client.test.ts`, `.env.example`

## [064] Add unit tests for email service and kiyoh review client

**What**: Created test suites for `email-service` and `kiyoh-review-client` covering SMTP validation, translation loading, HTML rendering, and reviewer email resolution.
**Files**: `tests/services/email-service.test.ts`, `tests/services/kiyoh-review-client.test.ts`

## [063] Add dispute page placeholder with localization

**What**: Created public `/dispute` server component page with localized placeholder text and reviewId display from search params.
**Files**: `app/dispute/page.tsx`, all 8 `messages/*.json` files

## [062] Integrate email notification into admin disable route

**What**: After a successful "disable" or "disable-manual" action in the admin route, the handler now resolves the reviewer email via Kiyoh API and sends a notification email.
**Decisions**:
- For "disable": tenantId/locationId from ReceiptSyncState, failureReason from Receipt (fallback `VERIFICATION_FAILED`)
- For "disable-manual": uses provided reviewId/tenantId, generic reason `ADMIN_DISABLED`
- Extracted `sendDisableNotification` helper that catches all errors — email never affects HTTP response

## [061] Integrate email notification into review-disable worker

**What**: After a successful review disable, the worker now resolves the reviewer email via Kiyoh API and sends a notification email with the receipt's failure reason.
**Decisions**:
- Email failures logged as warnings, never affect job success
- Default failure reason `VERIFICATION_FAILED` used if receipt lookup returns null
- Outer try-catch ensures no unexpected error can propagate from notification logic

## [060] Add Kiyoh review client for reviewer email resolution

**What**: Created `lib/review-disable/kiyoh-review-client.ts` with `resolveReviewerEmail(reviewId, tenantId)` that fetches the reviewer's email from the Kiyoh review list API (never throws).
**Decisions**:
- Reuses `authenticateKiyohAdmin()` for bearer token (cached)
- Returns `ReviewerEmailResult` with success/email/error fields
- Added `KIYOH_REVIEW_LIST_URL` to `.env.example` with default `https://www.klantenvertellen.nl/v1/review`
**Files**: `lib/review-disable/kiyoh-review-client.ts`, `.env.example`

## [059] Add email service module for review-disable notifications

**What**: Created `lib/email/email-service.ts` with `sendReviewDisableEmail` function that validates SMTP config, creates a lazy Nodemailer transport singleton, loads translations, renders HTML, sends email, and returns an `EmailResult` (never throws).
**Decisions**:
- Lazy singleton transport created on first successful send (avoids startup failures)
- SMTP config validated at call time; returns failure result if any var is missing
- Added `nodemailer@8.0.7` and `@types/nodemailer@8.0.0` as exact-pinned dependencies
- Added `APP_URL` to `.env.example` for dispute link construction
**Files**: `lib/email/email-service.ts`, `package.json`, `.env.example`

## [058] Add email translations and template modules for review-disable notifications

**What**: Created `lib/email/email-translations.ts` (server-side translation loader) and `lib/email/email-templates.ts` (inline-styled HTML renderer). Added `ReviewDisableEmail` namespace with 16 keys to all 8 locale files.
**Decisions**:
- Reads JSON files directly via `fs` for use in queue worker context (no React/next-intl dependency)
- Falls back to `en` locale when requested locale is unsupported or file is missing
- Maps failure reason codes (e.g. `NOT_A_RECEIPT`) to translation keys via constant map
**Files**: `lib/email/email-translations.ts`, `lib/email/email-templates.ts`, `messages/*.json` (all 8)

## [057] Add "requires_review" verification status for medium-confidence OCR results

**What**: Receipts that process successfully but don't meet the high-confidence threshold now get `requires_review` status instead of staying as `pending`.
**Why**: `pending` was ambiguous — it could mean "not yet processed" or "processed but inconclusive". The new status makes it clear the receipt was analyzed and needs human review.
**Decisions**:
- `requires_review` shows with a blue badge and Eye icon in the UI
- Dashboard filter groups `requires_review` with `pending` under the "Pending" tab
- Admin stats count both `pending` and `requires_review` in the pending bucket
**Files**: `lib/services/ocr-service.ts`, `app/dashboard/page.tsx`, `app/admin/page.tsx`, `app/archive/page.tsx`, `lib/services/admin-service.ts`, `messages/*.json`, `tests/services/ocr-service.test.ts`

## [056] Fix PDF OCR by converting to images before sending to LLM

**What**: PDFs are now rendered to PNG images server-side using `pdfjs-dist` + `@napi-rs/canvas` before being sent to the OpenAI API, fixing 400 errors caused by sending `application/pdf` data URIs to the Chat Completions endpoint.
**Why**: OpenAI Chat Completions only accepts image formats (JPEG, PNG, GIF, WebP) in `image_url` content — not PDFs. The previous Files API fallback also only works with the Assistants API.
**Decisions**:
- Uses `pdfjs-dist` (pure JS) + `@napi-rs/canvas` (Rust, no native compilation) — no system deps needed in Alpine Docker
- Converts up to 3 pages per PDF at 2x scale, sends all as separate `image_url` entries
- Moved `@napi-rs/canvas` from devDependencies to dependencies for production availability
**Files**: `lib/pdf-to-image.ts`, `lib/services/ocr-service.ts`, `package.json`, `tests/services/ocr-service.test.ts`

## [055] Add health endpoint to queue worker and queue-worker-dev service

**What**: Added an HTTP health check server to the queue worker process (GET `/health` on port 3001) and a `queue-worker-dev` service to docker-compose.
**Why**: Railway requires an HTTP health check to confirm the service is alive. Dev mode had no worker running so enqueued jobs were never processed.
**Files**: `scripts/queue-worker.ts`, `docker-compose.yml`, `.env.example`

## [054] Fix OCR processing for KV-synced receipts and test env isolation

**What**: Receipt worker now routes `kv-sync:` paths to KvS3Client instead of the default R2 bucket, fixing OCR/fraud detection for auto-verified synced receipts. Also fixed review-disable tests leaking host env vars.
**Why**: Synced receipts were failing OCR because `getFileAsBuffer` fetched from R2 where they don't exist. Tests failed because they didn't isolate URL env vars from the host.
**Files**: `lib/queue/receipt-worker.ts`, `tests/services/review-disable-service.test.ts`

## [053] Add Sync Now button, review disable/enable on receipts, rename reviews to platforms

**What**: Added "Sync Now" button and review disable/enable toggle on receipt cards in the dashboard and admin pages. Moved ManualDisableForm to admin page. Renamed `/admin/reviews` to `/admin/platforms`.
**Decisions**:
- Disable/enable button appears on rejected/flagged receipts, uses the `disable`/`enable` actions which look up ReceiptSyncState by receiptId
- Client tracks disabled state locally (optimistic) since the API doesn't return current review status
- Route renamed from `/admin/reviews` to `/admin/platforms` to prevent confusion with receipt reviews
- Toggle removed from platform review cards (those are for browsing, not managing)
**Files**: `app/admin/platforms/page.tsx`, `app/admin/page.tsx`, `app/dashboard/page.tsx`, `app/admin/moderation/page.tsx`, `components/header.tsx`, `app/api/admin/receipt-sync/trigger/route.ts`, `app/api/admin/reviews/disable/route.ts`, `lib/review-disable/review-disable-service.ts`, `messages/*.json`

## [052] Fix code review findings from 26.05.15-cleanup-sprint

**What**: Resolved all 15 standards violations, 4 localization issues, and 3 stability issues from the cleanup sprint code review.
**Decisions**:
- Ternaries replaced with if-else blocks across 8 files
- Magic numbers extracted to named constants in queue configs
- Chained `??` in moderation page replaced with explicit if-null checks
- `as any` cast replaced with proper Prisma type assertion
- Added `ReceiptCard` translation namespace with failure reason labels in all 8 languages
- Wrapped `request.json()` and external `JSON.parse()` calls in try-catch
- Added REDIS_URL startup warning in queue worker
**Files**: `lib/services/receipt-service.ts`, `lib/queue/receipt-worker.ts`, `lib/queue/review-disable-worker.ts`, `lib/queue/receipt-queue.ts`, `lib/queue/review-disable-queue.ts`, `lib/receipt-sync/receipt-creator.ts`, `lib/review-disable/kiyoh-auth-client.ts`, `lib/services/ocr-service.ts`, `app/api/receipts/route.ts`, `app/admin/moderation/page.tsx`, `app/api/locale/route.ts`, `scripts/queue-worker.ts`, `components/admin-receipt-card.tsx`, `components/receipt-card.tsx`, `app/admin/page.tsx`, `messages/*.json`

## [051] Use gpt-5.4-mini for secondary analysis with improved prompt

**What**: Secondary analysis now uses a separate, configurable model (`SECONDARY_AI_MODEL_NAME`, defaults to `gpt-5.4-mini`) and an improved prompt that includes the full primary extraction data and instructs the model to independently review the image rather than just rubber-stamp the rejection.
**Why**: Mini is more capable than nano for nuanced judgment calls; the old prompt only passed confidence/readable/failure reason, missing the extracted fields that provide context for the review.
**Decisions**:
- New env var `SECONDARY_AI_MODEL_NAME` (defaults to `gpt-5.4-mini`)
- Prompt now includes extracted shop name, date, and amount from primary analysis
- Prompt instructs the model to look at the image independently, not blindly trust primary
**Files**: `lib/services/ocr-service.ts`, `.env.example`

## [050] Remove manual upload UI and Google Drive import

**What**: Removed the upload button, Google Drive import button, and their modals from the dashboard. Deleted the Drive service, API routes, component, and tests. Kept the upload API endpoint and component file for future dispute system use.
**Decisions**:
- Upload endpoint (`/api/upload/presigned`) and `receipt-upload.tsx` component preserved for future dispute uploads
- Drive API routes, service, component, and all related tests deleted

## [049] Add review disable queue with audit logging

**What**: After OCR rejects a receipt and secondary analysis confirms the rejection, a review-disable job is enqueued on a dedicated BullMQ queue (concurrency 1) that disables the review on Kiyoh/KV with exponential backoff retries, logging every attempt to a `ReviewDisableAudit` table.
**Why**: Fire-and-forget disable had no visibility or retry. Separate queue prevents slow Kiyoh API calls from blocking OCR processing, while sequential processing (concurrency 1) avoids hammering the platform.
**Decisions**:
- Separate `review-disable` BullMQ queue with concurrency 1
- `ReviewDisableAudit` table tracks receiptId, reviewId, locationId, tenantId, status, attempts, errors
- Only triggers when `RECEIPT_AUTO_DISABLE_ENABLED=true` AND secondary analysis contains "Initial analysis valid"
- Uses existing `MAX_RETRY_ATTEMPTS` env var for max attempts (default 5)
- Base backoff delay 10s with exponential growth
**Files**: `prisma/schema.prisma`, `prisma/migrations/20260601000002_add_review_disable_audit/migration.sql`, `lib/queue/review-disable-queue.ts`, `lib/queue/review-disable-worker.ts`, `lib/queue/receipt-worker.ts`, `lib/queue/index.ts`, `scripts/queue-worker.ts`

## [048] Add context token exchange step to Kiyoh auth flow

**What**: After login (with or without OTP), the auth client now calls `GET /v1/common/context?hash=<loginHash>` to exchange the portal session hash for the real API bearer token.
**Why**: Kiyoh's login hash is a portal session id, not a valid bearer. The portal exchanges it via the context endpoint before making review API calls. Our code was sending the raw login hash, causing 401 `invalid_token` on every review disable/enable call.
**Decisions**:
- New env var `KIYOH_CONTEXT_URL` (defaults to KlantenVertellen for backwards compat)
- Removed unused `error.cause` accesses that broke `tsc --noEmit`
**Files**: `lib/review-disable/kiyoh-auth-client.ts`, `tests/services/review-disable-service.test.ts`, `.env`, `.env.example`

## [047] Make review disable platform URLs configurable via env vars

**What**: The auth and review-active URLs in the review disable module are now configurable instead of hardcoded to klantenvertellen.nl.
**Why**: Allows switching between Kiyoh and KlantenVertellen (or other platform instances) without code changes.
**Decisions**:
- Three new env vars: `KIYOH_AUTH_BASE_URL`, `KIYOH_REVIEW_API_BASE_URL`, `KIYOH_TENANT_ID`
- All default to the existing KlantenVertellen values for backwards compatibility
- Tenant ID parsed at call time (not module load) so env can be changed without restart in tests
**Files**: `lib/review-disable/kiyoh-auth-client.ts`, `lib/review-disable/review-disable-service.ts`, `.env.example`

## [046] Add BullMQ message queue for async receipt OCR processing

**What**: Receipt OCR and fraud re-scoring now runs asynchronously via a BullMQ worker backed by Redis, instead of blocking the HTTP response or running fire-and-forget.
**Why**: Synchronous OCR blocked uploads for seconds; fire-and-forget in Drive import had no retry or visibility. Queue gives retries (3 attempts, exponential backoff), concurrency control, and job tracking.
**Decisions**:
- Redis 7 Alpine in its own docker-compose container
- BullMQ with ioredis — lightweight, Node-native, no extra protocol
- Added `processingStatus` field to Receipt (idle/queued/processing/completed/failed) for client polling
- Separate `queue-worker` container in docker-compose runs the worker process
- Drive import's 200-line inline `triggerOCR` removed — now enqueues like regular uploads
- Receipt-sync module (`RECEIPT_AUTO_VERIFY_ENABLED=true`) now enqueues for real OCR processing instead of blindly marking as "verified"
- Synced receipts with auto-verify OFF get `processingStatus: "idle"` (not queued, awaiting manual trigger)
- Worker reuses existing `processReceiptOcr` from ocr-service (no logic duplication)
**Files**: `lib/queue/connection.ts`, `lib/queue/receipt-queue.ts`, `lib/queue/receipt-worker.ts`, `lib/queue/index.ts`, `scripts/queue-worker.ts`, `docker-compose.yml`, `prisma/schema.prisma`, `prisma/migrations/20260515000000_add_processing_status_and_queue/migration.sql`, `app/api/receipts/route.ts`, `app/api/drive/import/route.ts`, `lib/services/receipt-service.ts`, `lib/receipt-sync/receipt-creator.ts`, `.env.example`, `package.json`

## [045] Add failure reasons, secondary analysis, and English-only to OCR judging

**What**: Enhanced the AI receipt verification system with structured failure reason codes, a secondary AI analysis pass on rejections, and enforced English-only responses.
**Why**: Failure reasons were implicit in the confidence/readable flags — now they're explicit and consistent. Secondary analysis catches borderline rejections and adds nuance.
**Decisions**:
- Failure reasons are string enum-like values stored in DB (not a Prisma enum) for flexibility: NOT_A_RECEIPT, IMAGE_UNCLEAR, INSUFFICIENT_INFO, DUPLICATE_RECEIPT, RECEIPT_TOO_OLD, SUSPECTED_FRAUD, UNREADABLE_TEXT, MISSING_KEY_FIELDS
- Secondary analysis only runs on rejections to avoid unnecessary API calls
- System-level failure reasons (DUPLICATE_RECEIPT, RECEIPT_TOO_OLD, SUSPECTED_FRAUD) are set by code logic, not the AI
- English enforced via prompt instruction regardless of receipt language
- Both the streaming OCR endpoint and the batch `processReceiptOcr` function updated
- Admin card shows failure reason + secondary analysis in expanded view; user card shows inline under confidence bar
**Files**: `lib/services/ocr-service.ts`, `prisma/schema.prisma`, `prisma/migrations/20260601000001_add_failure_reason_and_secondary_analysis/migration.sql`, `app/api/receipts/[id]/ocr/route.ts`, `components/receipt-card.tsx`, `components/admin-receipt-card.tsx`, `tests/services/ocr-service.test.ts`

## [044] Cap AI analysis reasoning via prompt instruction

**What**: Added `OCR_REASONING_MAX_TOKENS` env var (default 150) that instructs the OCR model to keep its reasoning field under that token count.
**Files**: `lib/services/ocr-service.ts`, `.env.example`

## [043] Fix UI not updating after receipt reprocessing

**What**: Dashboard `handleReprocess` now reads the SSE stream from the OCR endpoint and waits for the `"completed"` event before refreshing data.
**Why**: The OCR endpoint returns a streaming response; the old code checked `response.ok` (which is true immediately on stream open) and called `fetchReceipts()` before processing finished, so the DB still had stale data.

## [042] Fix Kiyoh TOTP generation and add token caching

**What**: Fixed `Secret.fromBase32()` usage in TOTP generation (was passing raw string, producing wrong OTP codes) and added in-memory bearer token caching with 25-minute TTL to avoid re-authenticating on every API call.
**Why**: Every OTP code was invalid because the otpauth library treated the base32 secret as a raw UTF-8 string. Each failed OTP counted as a failed login attempt on Kiyoh's side, triggering account lockout even on a single disable attempt.
**Decisions**:
- 25-minute cache TTL (conservative, avoids expired token on actual API calls)
- Service retries once on 401 from the review-active endpoint (invalidates cache, re-authenticates, retries)
- Removed logging of request bodies that contained credentials and OTP codes
**Files**: `lib/review-disable/kiyoh-auth-client.ts`, `lib/review-disable/review-disable-service.ts`, `tests/services/review-disable-service.test.ts`

## [041] Add i18n infrastructure with next-intl and language selector

**What**: Installed next-intl, set up cookie-based locale persistence, added a language selector dropdown in the header, created full translation files for all 8 languages, and wired up `useTranslations()` in all page components.
**Decisions**:
- Cookie-based locale persistence (`NEXT_LOCALE`) set directly on the client — no async API call needed for switching
- `window.location.reload()` after cookie set to ensure clean server re-render (no flash)
- Removed Accept-Language detection to avoid flash between detected locale and cookie locale
- Default locale is `nl` (Dutch) since the primary audience is Dutch
- Split `lib/i18n.ts` (server-only) from `lib/i18n-config.ts` (shared constants) to avoid `next/headers` import in client components
- Removed Pino transport worker (was causing crashes in Next.js dev mode webpack bundling)
**Files**: `lib/i18n.ts`, `lib/i18n-config.ts`, `next.config.js`, `app/layout.tsx`, `app/api/locale/route.ts`, `components/language-selector.tsx`, `components/header.tsx`, `app/login/page.tsx`, `app/signup/page.tsx`, `app/dashboard/page.tsx`, `app/archive/page.tsx`, `app/admin/page.tsx`, `app/admin/moderation/page.tsx`, `app/admin/reviews/page.tsx`, `app/admin/settings/automation/page.tsx`, `lib/logger.ts`, `messages/*.json`

## [040] Move admin nav tabs from dashboard into header

**What**: Removed the tab-style admin buttons (Review Moderatie, Review Platforms, Admin Panel) from the dashboard page and added Moderation/Platforms links to the header nav. Renamed header "Reviews" button to "Platforms". Removed the "Review Platforms (Full)" tab from the admin page since it's now accessible via the header.
**Files**: `app/dashboard/page.tsx`, `components/header.tsx`, `app/admin/page.tsx`

## [039] Remove dead Review Queue tab from dashboard

**What**: Removed the non-functional "Review Queue" tab button and its associated state/data-fetching from the dashboard page.
**Why**: The tab set `activeTab` to `"queue"` but no UI rendered for that state, leaving users with a blank screen.

## [038] Fix admin page crash from paginated receipts response

**What**: Admin page called `.filter()` on the raw API response object instead of extracting the `receipts` array from the pagination envelope introduced in [035].
**Why**: Change [035] wrapped the `/api/receipts` response in `{ receipts, nextCursor, hasMore }` but the admin page fetch was never updated.

## [037] Use POLL_INTERVAL_SECONDS env var for dashboard auto-refresh

**What**: Dashboard pending-receipt polling now uses the server-configured `POLL_INTERVAL_SECONDS` instead of a hardcoded 5-second interval.
**Decisions**:
- Poll interval is included in the `/api/receipts` JSON response so the client component can read it without `NEXT_PUBLIC_` prefix
- Falls back to 300s (5 min) if env var is missing or invalid
**Files**: `app/api/receipts/route.ts`, `app/dashboard/page.tsx`

## [036] Add app-dev container for local development with hot reload

**What**: Added `app-dev` service to docker-compose that bind-mounts source code and runs `npm run dev` for live reload on file changes.
**Decisions**:
- Reuses the `dependencies` Dockerfile stage (has node_modules installed, no build step)
- Anonymous volume for `/app/node_modules` prevents host overwriting container deps
- `WATCHPACK_POLLING=true` ensures file-change detection works across Docker filesystem boundaries
- Runs `prisma generate` before dev server to ensure client is up to date

## [035] Add infinite scroll pagination to receipt list

**What**: Dashboard receipt list now loads 15 receipts at a time with cursor-based pagination and infinite scroll
**Decisions**:
- Cursor-based pagination using Prisma's `cursor` + `skip: 1` pattern for stable ordering
- IntersectionObserver on a sentinel div at the bottom of the table triggers loading more
- API response changed from flat array to `{ receipts, nextCursor, hasMore }` envelope
**Files**: `app/api/receipts/route.ts`, `lib/services/receipt-service.ts`, `app/dashboard/page.tsx`, `tests/routes/receipts.test.ts`, `tests/services/receipt-service.test.ts`

## [034] Fix OCR for KV-synced receipts and GPT-5.4 nano compatibility

**What**: Fixed OCR processing for receipts synced from KV (stored in separate S3 bucket), switched `max_tokens` to `max_completion_tokens` for GPT-5.4 nano, added error body logging to LLM API calls, fixed Kiyoh auth URL and tenantId.
**Decisions**:
- OCR route now detects `kv-sync:` prefix and uses KvS3Client to fetch from the correct bucket
- `max_completion_tokens` replaces deprecated `max_tokens` for newer OpenAI models
- Auth URL corrected to `klantenvertellen.nl` (not `kiyoh.com`), tenantId corrected to 99
**Files**: `app/api/receipts/[id]/ocr/route.ts`, `lib/services/ocr-service.ts`, `lib/review-disable/kiyoh-auth-client.ts`, `app/admin/reviews/page.tsx`, `tests/services/ocr-service.test.ts`, `tests/services/review-disable-service.test.ts`

## [033] Add review disable/enable on failed verification

**What**: Disable (and re-enable) reviews on KlantenVertellen when receipt verification fails, with Kiyoh admin TOTP auth, auto-disable on rejection, and manual disable form.
**Decisions**:
- Tokens not cached (admin operations are infrequent)
- Auto-disable is fire-and-forget (non-blocking) controlled by RECEIPT_AUTO_DISABLE_ENABLED env var
- Manual disable form accepts raw reviewId/locationId/tenantId without requiring a linked receipt
- Added `otpauth` dependency for TOTP generation
**Files**: `lib/review-disable/kiyoh-auth-client.ts`, `lib/review-disable/review-disable-service.ts`, `app/api/admin/reviews/disable/route.ts`, `app/api/admin/receipts/route.ts`, `app/admin/reviews/page.tsx`, `tests/services/review-disable-service.test.ts`, `messages/*.json`

## [032] Fix KV API response parsing and process reviews per-location

**What**: Fixed locations URL (removed `dateSince`, only `updatedSince`), fixed reviews response parsing (`response.reviews[]` with `dateSince` as creation date), restructured sync engine to process reviews immediately per-location with resumability.
**Decisions**:
- Locations endpoint only needs `updatedSince` (returns locations with new reviews, not newly created)
- Reviews response is `{ reviews: [{ reviewId, dateSince, reviewAuthor, rating, ... }] }` — mapped to internal `ReviewDto`
- Process reviews immediately after each location fetch (receipts appear in admin as they're found)
- Track location progress via marker records in `ReceiptSyncState` so interrupted ticks resume from last location
- Default backfill changed from 30 days to 5 days
**Files**: `lib/receipt-sync/kv-api-client.ts`, `lib/receipt-sync/sync-engine.ts`, `lib/receipt-sync/types.ts`, `lib/services/receipt-sync-service.ts`, `app/api/admin/receipt-sync/backfill/route.ts`, `scripts/backfill-sync.sh`

## [031] Fix KV API client URLs and add backfill script

**What**: Fixed incorrect API endpoint paths in `kv-api-client.ts` to match the real KV publication API; added `scripts/backfill-sync.sh` for triggering backfill from CLI.
**Decisions**:
- Locations uses offset-based pagination (`start` param), reviews uses `pageNumber` — matching the actual API
- Reviews endpoint returns `{ reviews: [...] }` wrapper, not a bare array — added response unwrapping
- `KV_API_BASE_URL` should be set to `https://www.klantenvertellen.nl/v1/publication` (includes the `/v1/publication` path prefix)
- Backfill script authenticates via NextAuth cookie flow (CSRF → credentials callback → session cookie)
**Files**: `lib/receipt-sync/kv-api-client.ts`, `.env.example`, `scripts/backfill-sync.sh`

## [030] Extract receipt-sync-service and fix pre-existing type errors

**What**: Moved business logic from receipt-sync route handlers into `lib/services/receipt-sync-service.ts`; fixed 5 pre-existing type errors across the codebase.
**Decisions**:
- Excluded `vitest.config.ts` from tsconfig (TS 5.2 can't parse `@vitejs/plugin-react@6` type defs)
- Added `getFileUrl` to `StorageUploadClient` interface (was missing, causing type mismatch with `StorageClient`)
- Cast `RequestInit` to `Record<string, unknown>` in test helpers (Next.js `RequestInit` type doesn't accept `signal: null`)
- Service uses dependency injection consistent with other services
**Files**: `tsconfig.json`, `lib/services/receipt-sync-service.ts`, `lib/services/drive-service.ts`, `app/api/admin/receipt-sync/health/route.ts`, `app/api/admin/receipt-sync/backfill/route.ts`, `tests/routes/admin.test.ts`, `tests/routes/drive.test.ts`, `tests/routes/receipts.test.ts`, `tests/routes/reviews.test.ts`, `tests/services/drive-service.test.ts`

## [029] Add unit tests for ocr-service

**What**: Created `tests/services/ocr-service.test.ts` with 19 unit tests covering all exported OCR service functions
**Decisions**:
- Mocks global fetch directly for API call tests rather than module-level mocking
- Tests verification status logic against actual priority order (verified check before duplicate check)
- Saves/restores process.env for config tests

## [028] Add unit tests for receipt-service

**What**: Created `tests/services/receipt-service.test.ts` with 26 unit tests covering all exported service functions
**Decisions**:
- Uses dependency injection directly (no module-level mocking needed)
- Tests both success and error paths for each function
- Covers access control, fraud pipeline, admin action logging, and date grouping

## [027] Rewire all route handlers to delegate to service functions

**What**: Converted 21 route handlers into thin wrappers (parse → auth → service → respond)
**Decisions**:
- Drive routes keep inline getAccessToken/triggerOCR to preserve exact test behavior (service's refreshGoogleToken adds env var checks not present in original)
- Automation PATCH/DELETE keep direct prisma calls since service adds existence checks the original didn't have
- OCR streaming route delegates message building and API call to ocr-service but keeps stream handling inline
- Admin receipts route unchanged (already thin, no matching service function needed)
**Files**: All 21 route.ts files under app/api/

## [026] Extract upload-service module

**What**: Created `lib/services/upload-service.ts` with generateUploadUrl (file type validation + presigned URL generation)
**Decisions**:
- StorageClient interface abstracts the presigned URL generation for testability
- Allowed content types defined as a named constant array
- Returns discriminated union result type consistent with auth-service pattern

## [025] Extract admin-service module

**What**: Created `lib/services/admin-service.ts` with getDashboardStats, listUsers, updateUserRole
**Decisions**:
- Super-admin emails stored as a named constant array (matches existing hardcoded list)
- updateUserRole returns statusCode in error case so route handler can map to correct HTTP status
- getDashboardStats preserves the exact same query structure and response shape as the current route

## [024] Extract automation-service module

**What**: Created `lib/services/automation-service.ts` with listWorkflows, getWorkflow, createWorkflow, updateWorkflow, deleteWorkflow, executeWorkflow
**Decisions**:
- Platform credentials passed via dependency object rather than reading process.env inside the service
- Delegates actual execution to existing lib/automation/executor.ts (no duplication)
- executeWorkflow returns structured response matching the current route's JSON shape for easy rewiring

## [023] Extract drive-service module

**What**: Created `lib/services/drive-service.ts` with getAccessToken, listDriveFiles, and importDriveFile
**Decisions**:
- Delegates token refresh to auth-service's refreshGoogleToken instead of duplicating OAuth logic
- Delegates receipt creation to receipt-service's createReceipt with fraud detection
- Delegates OCR to ocr-service's processReceiptOcr (fire-and-forget, non-blocking)
- Storage upload interface accepts generatePresignedUploadUrl + getFileAsBuffer for testability

## [022] Extract review-platform-service module

**What**: Created `lib/services/review-platform-service.ts` with fetchLocations, fetchReviewsForLocation, moderateReview, fetchPendingReviews, fetchNotificationCount
**Decisions**:
- Token passed explicitly per call rather than via dependency object (no DB/storage needed)
- Sequential fetching with rate-limit delay preserved from original moderation route
- Pending status detection uses set-based lookup instead of chained OR conditions

## [021] Extract ocr-service module

**What**: Created `lib/services/ocr-service.ts` with buildOcrMessages, buildOcrMessagesWithFileUpload, callOcrApi, parseOcrResult, determineVerificationStatus, processReceiptOcr
**Why**: Deduplicates OCR logic from receipts/[id]/ocr (streaming) and drive/import (non-streaming) routes
**Decisions**:
- Returns raw Response from callOcrApi so route handlers control streaming vs non-streaming consumption
- buildOcrMessagesWithFileUpload handles the OpenAI Files API upload path for PDFs (streaming route)
- buildOcrMessages uses base64 data URI fallback (non-streaming route and PDF upload failure)
- FraudDetectionClient interface decouples from the singleton fraud-detection module

## [020] Extract receipt-service module

**What**: Created `lib/services/receipt-service.ts` with listReceipts, getReceipt, createReceipt, updateReceiptStatus, archiveReceipts, listArchivedReceipts, getDownloadUrl
**Decisions**:
- FraudDetectionModule passed as explicit parameter to createReceipt (avoids importing singleton)
- StorageClient interface abstracts S3 operations (getFileUrl, getFileAsBuffer)
- Fraud pipeline failure is non-fatal — proceeds with zero-risk defaults

## [019] Extract auth-service module

**What**: Created `lib/services/auth-service.ts` with validateCredentials, registerUser, and refreshGoogleToken
**Why**: First service extraction — consolidates duplicated token refresh logic and isolates auth business logic from route handlers
**Decisions**:
- Discriminated union result types instead of throwing errors
- Input validation (Zod) happens inside registerUser since it's a boundary function
- refreshGoogleToken accepts accountId and handles both fresh-token and refresh cases
## [018] Add property-based tests for receipt-sync service

**What**: Created `tests/receipt-sync/properties.test.ts` with 8 property-based tests (16 assertions) using fast-check covering watermark safety subtraction, pagination termination, watermark max-date advancement, idempotent skip logic, dead letter eligibility, health status determination, auto-verify flag, and jitter bounds.
**Decisions**:
- Used integer-based date generators (mapped to Date) instead of `fc.date()` to avoid NaN date edge cases
- Tested pure logic functions inline rather than importing from modules that have side effects
- Imported `computeJitter` directly from `@/lib/receipt-sync` since it's exported
**Files**: `tests/receipt-sync/properties.test.ts`, `package.json`

## [017] Add receipt-sync health and backfill API routes

**What**: Created GET `/api/admin/receipt-sync/health` (returns 200/503 based on last tick recency vs 2×POLL_INTERVAL_SECONDS) and POST `/api/admin/receipt-sync/backfill` (admin-auth, sets watermark to now-30d, executes immediate tick, requires force if watermark already recent).
**Decisions**:
- Health endpoint has no auth (for monitoring systems); backfill requires admin session
- Backfill returns 409 conflict when watermark is within 30 days without force flag
**Files**: `app/api/admin/receipt-sync/health/route.ts`, `app/api/admin/receipt-sync/backfill/route.ts`

## [016] Implement receipt-sync module

**What**: Created the full `lib/receipt-sync/` module with config loading, KV API client (paginated AsyncGenerator with rate limiting and retry), dedicated S3 client for eu-central-1, Prisma state repository, receipt creator, sync engine with concurrency-limited tick execution, and singleton sync loop with jitter.
**Decisions**:
- Created shared `lib/logger.ts` (pino-based) per AGENTS.md rules — installed pino dependency
- Added `npm run check` script (tsc --noEmit) since it was missing
- System user created on-demand with cached ID for receipt creation
- Jitter computed as random 0–10% of poll interval per requirement 4.6
- S3 operations gracefully disabled when bucket name is not configured
**Files**: `lib/logger.ts`, `lib/receipt-sync/types.ts`, `lib/receipt-sync/config.ts`, `lib/receipt-sync/kv-api-client.ts`, `lib/receipt-sync/kv-s3-client.ts`, `lib/receipt-sync/state-repository.ts`, `lib/receipt-sync/receipt-creator.ts`, `lib/receipt-sync/sync-engine.ts`, `lib/receipt-sync/index.ts`, `package.json`

## [015] Add receipt sync Prisma models and environment variables

**What**: Added ReceiptSyncState, ReceiptSyncWatermark, and ReceiptSyncTick models to the Prisma schema with indexes, created the migration SQL, and added all receipt sync service environment variables to .env.example.
**Decisions**:
- Migration created manually (database not available in CI) — needs `prisma migrate deploy` on next startup
- Separate S3 credentials (KV_RECEIPT_AWS_*) to avoid conflicting with existing R2 config
**Files**: `prisma/schema.prisma`, `prisma/migrations/20260601000000_add_receipt_sync_models/migration.sql`, `.env.example`

## [014] Add AI integration test for OCR extraction

**What**: Created `tests/ai-integration/ocr-extraction.test.ts` that sends the fixture image to the real AI API and validates the response schema
**Decisions**:
- Self-contained test — constructs the API call directly without importing app code
- Skips gracefully via `describe.skipIf` when `AI_API_KEY` is not set
- Validates all six schema fields: extractedShopName, extractedDate, extractedAmount, receiptReadable, confidence, reasoning

## [013] Add unit tests for fraud detection module

**What**: Created `tests/lib/fraud-detection.test.ts` with 43 tests covering all exported functions
**Decisions**:
- Pure functions tested directly (calculateImageHash, analyzeMetadata, calculateFraudRiskScore)
- DB-dependent functions (checkForDuplicates, detectSuspiciousPatterns) tested with mocked Prisma
- Covered edge cases: empty buffers, null/undefined values, boundary conditions, score capping

## [012] Add integration tests for automation routes

**What**: Created `tests/routes/automation.test.ts` with 33 tests covering workflows CRUD (GET list, POST create, GET single, PATCH update, DELETE) and execute POST (dry-run + live mode, error cases).
**Decisions**:
- Mocked `@/lib/automation/executor` to avoid Playwright dependency in tests
- Tested credential injection for both KV and Kiyoh platforms
- Covered corrupted steps, disabled workflows, and partial execution failure scenarios

## [011] Add integration tests for Google Drive routes

**What**: Created `tests/routes/drive.test.ts` with 19 tests covering files GET (token refresh, unauthorized, shared files) and import POST (full pipeline: download → S3 → receipt + fraud detection → OCR trigger).
**Decisions**:
- Used `decodeURIComponent` on URLs in fetch mock to reliably match Google Drive API query patterns
- Mocked the background OCR trigger by returning null from `receipt.findUnique` (triggerOCR exits early)

## [010] Add integration tests for review routes

**What**: Created `tests/routes/reviews.test.ts` with 34 tests covering locations GET, location reviews GET, moderate POST (abuse/changerequest/respond), moderation aggregation GET, and notifications GET.
**Decisions**:
- Used `Date.now()` spy to invalidate module-level memory cache between location tests
- Global `beforeEach` resets env vars (`KIYOH_API_TOKEN`, `KV_API_TOKEN`) to ensure test isolation

## [009] Add integration tests for auth routes

**What**: Created `tests/routes/auth.test.ts` with 18 tests covering login POST (valid/invalid/missing fields) and signup POST (valid/duplicate/validation errors).
**Decisions**:
- Mocked bcrypt at module boundary with both default and named exports to match how bcryptjs is imported
- Signup route lives at `app/api/signup/route.ts` (not under `app/api/auth/signup/`)

## [008] Add integration tests for receipt routes

**What**: Created `tests/routes/receipts.test.ts` with 38 tests covering GET list, POST create (with fraud detection), GET single, PATCH status, archive POST/GET, download GET, and presigned upload POST.
**Decisions**:
- Mocked `next-auth` directly (not `next-auth/next`) since route handlers import from `"next-auth"`
- Fraud detection functions mocked individually to verify they are called with correct arguments

## [007] Add shared test mock factories

**What**: Created `tests/helpers/` with reusable mock factories for Prisma, S3, session, and fetch used across all test files.
**Files**: `tests/helpers/mock-prisma.ts`, `tests/helpers/mock-s3.ts`, `tests/helpers/mock-session.ts`, `tests/helpers/mock-fetch.ts`, `tests/helpers/index.ts`

## [006] Auto-baseline existing databases on first migration

**What**: Entrypoint now catches P3005 (non-empty schema) and automatically marks the initial migration as applied before retrying, so existing databases transition to migrations without manual intervention.

## [005] Run database seed on staging startup

**What**: Entrypoint now runs `prisma db seed` when `NODE_ENV` is not `production`, so staging containers get seeded automatically on boot.

## [004] Run Prisma migrations on container startup

**What**: Added a shared entrypoint script that runs `prisma migrate deploy` before starting the app in both production and staging Docker targets.
**Files**: `scripts/docker-entrypoint.sh`, `Dockerfile`

## [003] Add missing CMD instructions to Dockerfile

**What**: Added `CMD` to both production and staging stages — containers were exiting immediately with code 0 because there was nothing to run.

## [002] Add health endpoint and update Railway config

**What**: Added `/api/health` endpoint that checks database connectivity; updated railway.toml to use it.
**Files**: app/api/health/route.ts, railway.toml

## [001] Add Docker and Docker Compose setup

**What**: Multi-stage Dockerfile (Alpine, Node 20, standalone output) and docker-compose with PostgreSQL.
**Decisions**:
- Used Alpine-based images for small footprint
- Next.js standalone output mode for minimal production image
- Added x86_64 Prisma binary target alongside existing ARM64 target
**Files**: Dockerfile, docker-compose.yml, .dockerignore, prisma/schema.prisma

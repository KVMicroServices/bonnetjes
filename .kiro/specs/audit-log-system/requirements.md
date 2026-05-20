# Requirements Document

## Introduction

A general-purpose audit log system for the receipt verification platform. The system records every important action across the application — AI judgements, moderation decisions, user management changes, settings modifications, and system events — into a single append-only log. The audit log provides category-based filtering and a paginated UI within the existing analytics page, replacing the current placeholder tab. The existing `AdminAction` table remains untouched.

## Glossary

- **Audit_Log_Service**: The service at `lib/services/audit-log-service.ts` responsible for writing audit log entries (fire-and-forget) and querying them with pagination and category filtering
- **Audit_Log_Model**: The Prisma model `AuditLog` storing all audit log entries in PostgreSQL
- **Analytics_Route**: The existing API route at `app/api/admin/analytics/route.ts` extended with `type=audit` query support
- **Audit_Log_Tab**: The UI component in the analytics page that displays audit log entries in a table with category filter buttons

## Requirements

### Requirement 1: Audit Log Data Model

**User Story:** As a developer, I want a general-purpose audit log model, so that any action in the platform can be recorded consistently.

#### Acceptance Criteria

1. THE Audit_Log_Model SHALL store an id (cuid), category (string), action (string, maximum 100 characters), actorId (optional string referencing the user who performed the action), metadata (optional JSON string, maximum 10,000 characters), and createdAt timestamp defaulting to the current time
2. THE Audit_Log_Model SHALL support the following category values: `ai_judgement`, `secondary_analysis`, `moderation`, `comment`, `user_management`, `settings`, `system`
3. THE Audit_Log_Model SHALL define a composite index on (category, createdAt) for efficient filtered queries, and a separate index on actorId for actor-based lookups
4. IF the referenced actor (user) is deleted, THEN THE Audit_Log_Model SHALL retain the audit log entry with the original actorId value preserved as a plain string (no cascading delete)

### Requirement 2: Audit Log Writer

**User Story:** As a developer, I want a fire-and-forget writer function, so that audit log writes never block or fail the calling operation.

#### Acceptance Criteria

1. WHEN an audit event is recorded, THE Audit_Log_Service SHALL insert a row into the audit log database table containing category, action, actorId (if provided), metadata (if provided), and a server-generated timestamp, without awaiting the database result in the calling code path
2. IF the audit log write fails, THEN THE Audit_Log_Service SHALL log the error via the shared logger including the category, action, and error message, and SHALL NOT propagate the exception to the caller
3. THE Audit_Log_Service SHALL accept the following parameters: category (non-empty string), action (non-empty string), optional actorId (string), and optional metadata (serializable key-value object)
4. WHEN the Audit_Log_Service is called, THE calling code path SHALL continue execution without waiting for the write to complete or fail

### Requirement 3: Audit Log Query

**User Story:** As an admin, I want to query audit logs with pagination and category filtering, so that I can review platform activity efficiently.

#### Acceptance Criteria

1. WHEN a query is requested with a category filter, THE Audit_Log_Service SHALL return only entries matching that category ordered by createdAt descending
2. WHEN a query is requested without a category filter, THE Audit_Log_Service SHALL return all entries ordered by createdAt descending
3. THE Audit_Log_Service SHALL support cursor-based pagination with a default page size of 25 entries, returning a nextCursor value and a hasMore boolean indicating whether additional entries exist beyond the current page

### Requirement 4: Audit Log API Endpoint

**User Story:** As a frontend developer, I want an API endpoint to fetch audit logs, so that the UI can display them.

#### Acceptance Criteria

1. WHEN the Analytics_Route receives a request with `type=audit`, THE Analytics_Route SHALL return audit log entries with cursor-based pagination, including a `nextCursor` value, `hasMore` boolean, and the `entries` array in the response
2. WHEN the request includes a `category` query parameter, THE Analytics_Route SHALL filter results to only entries matching that category
3. IF the request lacks a valid authenticated admin session, THEN THE Analytics_Route SHALL return a 401 status for missing authentication or a 403 status for non-admin users

### Requirement 5: Integration with OCR Processing

**User Story:** As an admin, I want AI judgement results logged automatically, so that I can trace verification decisions.

#### Acceptance Criteria

1. WHEN OCR processing completes with a verdict (verified, rejected, or requires_review), THE ocr-service SHALL record an `ai_judgement` audit entry containing the receipt ID, verdict, and confidence score in metadata
2. WHEN secondary analysis completes with a verdict (confirmed_rejection, overturned_to_verified, or requires_review), THE ocr-service SHALL record a `secondary_analysis` audit entry containing the receipt ID and verdict in metadata
3. IF recording an audit entry fails, THEN THE ocr-service SHALL log the error and continue processing without failing the OCR operation

### Requirement 6: Integration with Moderation Actions

**User Story:** As an admin, I want moderation actions logged, so that there is a record of who approved, rejected, or flagged each receipt.

#### Acceptance Criteria

1. WHEN a user approves, rejects, or flags a receipt, THE receipt-service SHALL record a `moderation` audit entry with the actor's user ID, receipt ID, and action in metadata
2. WHEN a review is disabled or enabled for a receipt, THE admin reviews disable route SHALL record a `moderation` audit entry with the actor's user ID, receipt ID, and action (disable/enable) in metadata

### Requirement 7: Integration with Admin Actions

**User Story:** As an admin, I want role changes and settings modifications logged, so that sensitive operations are traceable.

#### Acceptance Criteria

1. WHEN an admin changes a user's role, THE admin-service SHALL record a `user_management` audit entry with the admin's user ID, target user ID, old role, and new role in metadata
2. WHEN an admin modifies app settings (thresholds, feature flags), THE settings route SHALL record a `settings` audit entry with the admin's user ID and the changed setting keys in metadata

### Requirement 8: Integration with System Events

**User Story:** As an admin, I want automated system actions logged, so that I can trace auto-disable triggers, receipt syncing, and dispute processing.

#### Acceptance Criteria

1. WHEN the system auto-disables a review (triggered by rejection logic in receipt-worker or admin receipts route), THE calling code SHALL record a `system` audit entry with the receipt ID and review ID in metadata
2. WHEN a dispute is verified or rejected, THE dispute handler SHALL record a `system` audit entry with the receipt ID and outcome in metadata
3. WHEN a receipt is pulled from the review platform via the sync process, THE receipt-sync code SHALL record a `system` audit entry with the receipt ID and review ID in metadata
4. IF recording a system audit entry fails, THEN the calling code SHALL log the error and continue without failing the primary operation

### Requirement 9: Audit Log UI

**User Story:** As an admin, I want to view audit logs in a table with category filters, so that I can browse and filter platform activity.

#### Acceptance Criteria

1. THE Audit_Log_Tab SHALL display audit entries in a table with columns: timestamp (formatted to locale date-time), category, action, actor (displaying the actor's name or "System" when actorId is null), and a summary column showing a human-readable string derived from metadata
2. THE Audit_Log_Tab SHALL provide category filter buttons for each of the 7 defined categories plus an "All" option, with "All" selected by default, allowing only one active filter at a time
3. THE Audit_Log_Tab SHALL support cursor-based pagination using a "Load more" button that fetches the next page of entries, appending results below existing entries
4. THE Audit_Log_Tab SHALL use the translation system for all user-visible strings including column headers, filter button labels, empty state text, and loading indicators, with keys present in all 8 locale files
5. WHILE the Audit_Log_Tab is fetching data, THE Audit_Log_Tab SHALL display a loading indicator, and IF no entries match the current filter, THEN THE Audit_Log_Tab SHALL display an empty state message
6. THE Audit_Log_Tab SHALL display entries ordered by timestamp descending (newest first)

### Requirement 10: Navigation Changes

**User Story:** As a user, I want clear navigation labels, so that admin settings and user settings are distinguishable.

#### Acceptance Criteria

1. THE header navigation SHALL rename the existing admin settings link label from "Settings" to "Admin" (the link still points to `/admin/settings` and remains visible only to admin users) in both desktop and mobile navigation
2. THE header navigation SHALL add a new "Settings" nav item visible to all authenticated users that links to a placeholder user settings page at `/settings`
3. WHEN a user navigates to `/settings`, THE system SHALL render a placeholder page displaying a translated title and subtitle indicating user settings will be available in a future update
4. THE header navigation changes SHALL update all 8 locale files with the new translation keys

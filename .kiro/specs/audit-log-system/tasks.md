# Implementation Plan: Audit Log System

## Overview

Add an append-only AuditLog table, a fire-and-forget service layer, integrate audit calls into existing OCR/moderation/admin/sync flows, expose logs via the analytics API, build a filterable audit tab UI, and update navigation with locale support.

## Tasks

- [ ] 1. Add the AuditLog Prisma model with composite indexes and run the migration, then create `lib/services/audit-log-service.ts` with the fire-and-forget `recordAuditEvent` writer and cursor-based `getAuditLogs` query function
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3_

- [ ] 2. Extend `app/api/admin/analytics/route.ts` with a `type=audit` handler that accepts optional `category` and `cursor` query params, delegates to `getAuditLogs`, and returns `{ entries, nextCursor, hasMore }`
  - _Requirements: 4.1, 4.2, 4.3_

- [ ] 3. Add `recordAuditEvent` calls to OCR service (ai_judgement + secondary_analysis), receipt service (moderation), admin reviews disable route (moderation), admin service (user_management with adminId param), settings route (settings), receipt worker (system auto-disable), receipt creator (system sync), and dispute verify route (system dispute)
  - _Requirements: 5.1, 5.2, 5.3, 6.1, 6.2, 7.1, 7.2, 8.1, 8.2, 8.3, 8.4_

- [ ] 4. Build the AuditLogTab component in the analytics page with category filter pills, a table (time, category badge, action, actor, summary), cursor-based "Load more" pagination, loading spinner, and empty state — all strings via the translation system with keys added to all 8 locale files
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

- [ ] 5. Update `components/header.tsx` to rename the admin settings link to "Admin", add a new "Settings" link for all authenticated users pointing to `/settings`, create the placeholder `app/settings/page.tsx`, and add all new translation keys to all 8 locale files
  - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [ ] 6. Write unit tests for `audit-log-service` (writer error isolation, query pagination, category filtering) in `tests/services/audit-log-service.test.ts`
  - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3_

## Notes

- The `recordAuditEvent` writer must not await the database call — fire-and-forget with internal error logging via the shared logger
- `actorId` is a plain string with no foreign key — entries survive user deletion
- The `adminId` parameter needs to be threaded into `updateUserRole` from the calling route
- All locale files (en, nl, de, fr, es, af, xh, zu) must receive new keys for audit tab UI and navigation changes

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2", "3", "5"] },
    { "id": 2, "tasks": ["4", "6"] }
  ]
}
```

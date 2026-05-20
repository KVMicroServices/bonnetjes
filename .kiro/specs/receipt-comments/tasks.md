# Implementation Plan: Receipt Comments with @-Mentions

## Overview

Add a Comment model, comment service with mention notifications, API endpoints for comments and user search, a comment thread UI with @-mention autocomplete, and integrate into the admin receipt detail view.

## Tasks

- [x] 1. Add the Comment Prisma model with indexes and relations (User, Receipt), run the migration, add `comment_mention` to the notification type system in `notification-service.ts`
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 7.2_

- [x] 2. Create `lib/services/comment-service.ts` with `createComment` (validates body, stores mentions, fires mention notifications), `getComments` (receipt-scoped, chronological, with author details), `editComment` (author-only, validates body, updates mentions, notifies newly mentioned users), and `deleteComment` (author-or-admin check)
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 7.1, 7.3_

- [x] 3. Create API routes: `app/api/receipts/[id]/comments/route.ts` (GET + POST), `app/api/receipts/[id]/comments/[commentId]/route.ts` (PATCH + DELETE), and `app/api/users/search/route.ts` (GET with query param, excludes self, max 10 results, min 2 chars)
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4_

- [x] 4. Build `components/comment-thread.tsx` (comment list with author, relative time, edited indicator, mention highlighting, inline edit mode with save/cancel, delete with confirmation, compose input with submit) and `components/mention-autocomplete.tsx` (dropdown on @+2 chars, keyboard nav, debounced search, user selection inserts token), integrate into admin receipt detail view, add all translation keys to 8 locale files
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [x] 5. Write unit tests for `comment-service` (create validation, edit authorization and new-mention notifications, delete authorization, list ordering) in `tests/services/comment-service.test.ts`
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

## Notes

- The existing notification system is global (no userId FK on Notification). Mention notifications use the same broadcast pattern — the `metadata` field contains `mentionedUserId` so the frontend can filter relevance, and email delivery uses the preference system to target the right users.
- Comment body stores `@Name` as plain text. The `mentions` JSON array stores user IDs. Rendering cross-references both to apply highlight styling.
- The user search endpoint is intentionally not admin-only — any authenticated user can search for mention targets.
- The comment thread integrates into the existing admin page receipt detail view (modal or expandable section).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2", "3"] },
    { "id": 2, "tasks": ["4", "5"] }
  ]
}
```

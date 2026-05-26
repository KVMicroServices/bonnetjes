# Technical Design: Receipt Comments with @-Mentions

## Overview

Adds a `Comment` model linked to receipts and users, a comment service layer, API endpoints for CRUD and user search, a comment thread UI component with @-mention autocomplete, and integration with the existing notification system for mention alerts.

## Data Model

### Prisma Schema Addition

```prisma
model Comment {
  id        String   @id @default(cuid())
  body      String   @db.Text
  authorId  String
  author    User     @relation(fields: [authorId], references: [id], onDelete: Cascade)
  receiptId String
  receipt   Receipt  @relation(fields: [receiptId], references: [id], onDelete: Cascade)
  mentions  String?  @db.Text // JSON array of mentioned user IDs
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([receiptId, createdAt])
  @@index([authorId])
}
```

User model gets a `comments Comment[]` relation. Receipt model gets a `comments Comment[]` relation.

## Service Layer

### `lib/services/comment-service.ts`

```typescript
// ─── Types ───────────────────────────────────────────────────────────────────

interface CommentWithAuthor {
  id: string;
  body: string;
  authorId: string;
  receiptId: string;
  mentions: ReadonlyArray<string>;
  createdAt: Date;
  updatedAt: Date;
  author: {
    id: string;
    name: string | null;
    email: string;
  };
}

// ─── Service Functions ───────────────────────────────────────────────────────

async function createComment(params: {
  receiptId: string;
  authorId: string;
  body: string;
  mentions?: ReadonlyArray<string>;
}): Promise<CommentWithAuthor>
// Validates body length (1-2000 chars).
// Creates comment record with serialized mentions.
// Triggers mention notifications (fire-and-forget).
// Returns comment with author details.

async function getComments(receiptId: string): Promise<ReadonlyArray<CommentWithAuthor>>
// Returns all comments for receipt, ordered by createdAt asc.
// Includes author id, name, email.
// Deserializes mentions JSON.

async function deleteComment(commentId: string, userId: string, isAdmin: boolean): Promise<void>
// Verifies user is author or admin.
// Deletes the comment.
// Throws if unauthorized.

async function editComment(params: {
  commentId: string;
  userId: string;
  body: string;
  mentions?: ReadonlyArray<string>;
}): Promise<CommentWithAuthor>
// Verifies user is the author.
// Validates body length (1-2000 chars).
// Updates comment body and mentions.
// Triggers notifications for newly added mentions only.
// Returns updated comment with author details.
```

## API Endpoints

### `GET /api/receipts/[id]/comments`

Returns all comments for a receipt.

Response:
```json
{
  "comments": [
    {
      "id": "cuid",
      "body": "Looks good @John",
      "authorId": "cuid",
      "receiptId": "cuid",
      "mentions": ["user-id-1"],
      "createdAt": "2026-05-20T...",
      "author": { "id": "cuid", "name": "Jane", "email": "jane@example.com" }
    }
  ]
}
```

Auth: any authenticated user.

### `POST /api/receipts/[id]/comments`

Creates a comment.

Request body:
```json
{
  "body": "This receipt looks suspicious @Admin",
  "mentions": ["user-id-of-admin"]
}
```

Validation: body required, 1-2000 chars. mentions optional array of user ID strings.

Response: 201 with created comment.

### `DELETE /api/receipts/[id]/comments/[commentId]`

Deletes a comment. Author or admin only.

Response: 204 No Content.

### `PATCH /api/receipts/[id]/comments/[commentId]`

Edits a comment. Author only.

Request body:
```json
{
  "body": "Updated comment text @Admin",
  "mentions": ["user-id-of-admin"]
}
```

Validation: body required, 1-2000 chars. mentions optional.

Response: 200 with updated comment.

### `GET /api/users/search?q=<query>`

Returns matching users for mention autocomplete.

Response:
```json
{
  "users": [
    { "id": "cuid", "name": "John Doe", "email": "john@example.com" }
  ]
}
```

Auth: any authenticated user. Excludes the requester. Max 10 results. Minimum 2 chars in query.

## UI Design

### Comment Thread Component (`components/comment-thread.tsx`)

Placed inside the receipt detail view on the admin page (expandable section or within the existing receipt modal).

Structure:
1. **Comment list**: Scrollable area showing comments in chronological order
   - Each comment: author name (bold), relative time, body text
   - @-mentions in body rendered as highlighted `<span>` with the mentioned user's name
   - "(edited)" indicator shown when updatedAt > createdAt
   - Delete button (trash icon) visible to author and admins, with confirmation dialog
   - Edit button (pencil icon) visible to author only, switches to inline edit mode with save/cancel
2. **Compose area**: At the bottom
   - Textarea with placeholder "Write a comment..."
   - Submit button (disabled when empty)
   - @-mention autocomplete triggers on `@` + 2 chars

### Mention Autocomplete Component (`components/mention-autocomplete.tsx`)

Dropdown that appears above/below the textarea cursor position:
- Triggered when user types `@` followed by 2+ characters
- Shows list of matching users (name + email)
- Keyboard navigation: arrow keys to move, Enter to select, Escape to close
- Click to select
- Debounced search (300ms)
- On selection: inserts `@Name` as a styled token in the textarea, stores user ID in mentions state array

### Mention Display

In rendered comments, mentions stored as user IDs in the `mentions` array. The comment body contains `@Name` as plain text. When rendering, the component cross-references the mentions array with the display text to apply highlight styling.

## Notification Integration

### New Notification Type

Add `"comment_mention"` to the `NotificationType` union in `notification-service.ts` and to `NOTIFICATION_TYPES` array.

### Trigger

In `comment-service.ts` `createComment`, after successful insert:
```typescript
for (const mentionedUserId of mentions) {
  sendNotification({
    type: "comment_mention",
    title: `${authorName} mentioned you in a comment`,
    body: body.slice(0, 100),
    metadata: { receiptId, commentId, mentionedUserId },
  });
}
```

The existing notification system handles in-app display and email delivery based on user preferences.

### Notification Preference

Users can configure `comment_mention` preference (none/in_app/email) via the existing settings page. Default: `in_app`.

## File Changes Summary

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `Comment` model, add relations to User and Receipt |
| `prisma/migrations/...` | New migration |
| `lib/services/comment-service.ts` | New file — create, list, delete comments |
| `lib/services/notification-service.ts` | Add `comment_mention` to types and array |
| `app/api/receipts/[id]/comments/route.ts` | New file — GET + POST |
| `app/api/receipts/[id]/comments/[commentId]/route.ts` | New file — DELETE |
| `app/api/users/search/route.ts` | New file — user search for autocomplete |
| `components/comment-thread.tsx` | New file — comment list + compose |
| `components/mention-autocomplete.tsx` | New file — @-mention dropdown |
| `app/admin/page.tsx` | Integrate comment thread into receipt detail view |
| `messages/*.json` (all 8) | Add Comments namespace keys |
| `tests/services/comment-service.test.ts` | New test file |

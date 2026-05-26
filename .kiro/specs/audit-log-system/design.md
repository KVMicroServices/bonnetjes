# Technical Design: Audit Log System

## Overview

Adds a general-purpose `AuditLog` table and service layer that records platform actions across 7 categories. Integrates into existing OCR, moderation, admin, and sync flows via a fire-and-forget writer. Exposes data through the existing analytics API route and replaces the placeholder audit tab with a filterable table UI. Also renames the admin settings nav link and adds a user settings placeholder page.

## Data Model

### Prisma Schema Addition

```prisma
model AuditLog {
  id        String   @id @default(cuid())
  category  String   // ai_judgement, secondary_analysis, moderation, comment, user_management, settings, system
  action    String   // specific action within category
  actorId   String?  // user ID (null for system actions)
  metadata  String?  @db.Text // JSON blob with action-specific context
  createdAt DateTime @default(now())

  @@index([category, createdAt])
  @@index([actorId])
  @@index([createdAt])
}
```

No foreign key to User — actorId is a plain string preserved even if the user is deleted.

## Service Layer

### `lib/services/audit-log-service.ts`

```typescript
// ─── Types ───────────────────────────────────────────────────────────────────

type AuditCategory =
  | "ai_judgement"
  | "secondary_analysis"
  | "moderation"
  | "comment"
  | "user_management"
  | "settings"
  | "system";

interface AuditLogEntry {
  id: string;
  category: string;
  action: string;
  actorId: string | null;
  metadata: string | null;
  createdAt: Date;
}

interface AuditQueryResult {
  entries: ReadonlyArray<AuditLogEntry>;
  nextCursor: string | null;
  hasMore: boolean;
}

// ─── Writer (fire-and-forget) ────────────────────────────────────────────────

function recordAuditEvent(
  category: AuditCategory,
  action: string,
  actorId?: string,
  metadata?: Record<string, unknown>
): void
// Calls prisma.auditLog.create() without awaiting.
// Catches errors internally and logs via shared logger.

// ─── Query ───────────────────────────────────────────────────────────────────

async function getAuditLogs(options: {
  category?: AuditCategory;
  cursor?: string;
  limit?: number; // default 25
}): Promise<AuditQueryResult>
// Cursor-based pagination using id as cursor.
// Orders by createdAt desc.
```

## API Endpoint

Extend `app/api/admin/analytics/route.ts` GET handler:

```
GET /api/admin/analytics?type=audit&category=moderation&cursor=abc123
```

Response shape:
```json
{
  "entries": [...],
  "nextCursor": "cuid_value_or_null",
  "hasMore": true
}
```

Auth: requires admin session (existing check already in place).

## Integration Points

### OCR Service (`lib/services/ocr-service.ts`)

In `processReceiptOcr`, after the final `receipt.update`:
```typescript
recordAuditEvent("ai_judgement", finalVerificationStatus, undefined, {
  receiptId,
  verdict: finalVerificationStatus,
  confidence: finalConfidence,
});
```

If secondary analysis ran and returned a result:
```typescript
recordAuditEvent("secondary_analysis", secondaryResult.verdict, undefined, {
  receiptId,
  verdict: secondaryResult.verdict,
  confidence: secondaryResult.confidence,
});
```

### Receipt Service (`lib/services/receipt-service.ts`)

In `updateReceiptStatus`, after the AdminAction create:
```typescript
recordAuditEvent("moderation", status, adminId, {
  receiptId,
  action: status,
});
```

### Admin Reviews Disable Route (`app/api/admin/reviews/disable/route.ts`)

After each successful disable/enable action:
```typescript
recordAuditEvent("moderation", data.action, session.user.id, {
  receiptId: data.receiptId,
  action: data.action,
});
```

### Admin Service (`lib/services/admin-service.ts`)

In `updateUserRole`, after the successful update:
```typescript
recordAuditEvent("user_management", "role_changed", adminId, {
  targetUserId,
  oldRole: targetUser.email, // actually old role
  newRole,
});
```

Note: `updateUserRole` needs the calling admin's ID passed in (currently not passed — will add parameter).

### Settings Route (`app/api/admin/settings/route.ts`)

After successful PATCH, before returning:
```typescript
recordAuditEvent("settings", "settings_updated", session.user.id, {
  changedKeys: Object.keys(payload),
});
```

### Receipt Worker (`lib/queue/receipt-worker.ts`)

In `enqueueAutoDisableIfEligible`, after enqueuing:
```typescript
recordAuditEvent("system", "auto_disable_enqueued", undefined, {
  receiptId,
  reviewId: syncState.reviewId,
});
```

### Receipt Creator (`lib/receipt-sync/receipt-creator.ts`)

In `createReceiptFromSync`, after receipt creation:
```typescript
recordAuditEvent("system", "receipt_synced", undefined, {
  receiptId: receipt.id,
  reviewId: params.review.reviewId,
});
```

### Dispute Verify Route (`app/api/dispute/verify/route.ts`)

After successful verification:
```typescript
recordAuditEvent("system", "dispute_processed", undefined, {
  receiptId: result.receipt.id,
  outcome: result.receipt.verificationStatus,
});
```

## UI Design

### AuditLogTab Component

Replaces the placeholder in `app/admin/analytics/page.tsx`:

1. **Filter bar**: Row of pill buttons — "All", "AI Judgement", "Secondary Analysis", "Moderation", "Comment", "User Management", "Settings", "System". One active at a time.
2. **Table**: Columns — Time, Category (colored badge), Action, Actor, Summary.
   - Time: formatted with `toLocaleString()`
   - Category: badge with category-specific color
   - Action: the action string
   - Actor: resolved from metadata or shows "System"
   - Summary: short string derived from metadata (e.g., "Receipt abc → rejected", "Role changed to admin")
3. **Load more**: Button at bottom, fetches next page via cursor.
4. **Empty state**: Icon + message when no entries match filter.
5. **Loading**: Spinner while fetching.

### Navigation Changes

In `components/header.tsx`:
- Rename `t("settings")` link (admin-only, `/admin/settings`) to use new key `t("adminSettings")`
- Add new `t("settings")` link visible to all authenticated users, pointing to `/settings`

New page: `app/settings/page.tsx` — placeholder with title and "coming soon" subtitle.

## File Changes Summary

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `AuditLog` model |
| `prisma/migrations/...` | New migration |
| `lib/services/audit-log-service.ts` | New file — writer + query |
| `app/api/admin/analytics/route.ts` | Add `type=audit` handler |
| `lib/services/ocr-service.ts` | Add audit calls in `processReceiptOcr` |
| `lib/services/receipt-service.ts` | Add audit call in `updateReceiptStatus` |
| `lib/services/admin-service.ts` | Add audit call in `updateUserRole`, add `adminId` param |
| `app/api/admin/reviews/disable/route.ts` | Add audit calls |
| `app/api/admin/settings/route.ts` | Add audit call |
| `lib/queue/receipt-worker.ts` | Add audit call in auto-disable |
| `lib/receipt-sync/receipt-creator.ts` | Add audit call |
| `app/api/dispute/verify/route.ts` | Add audit call |
| `app/admin/analytics/page.tsx` | Replace AuditLogTab placeholder |
| `components/header.tsx` | Rename admin settings link, add user settings link |
| `app/settings/page.tsx` | New placeholder page |
| `messages/*.json` (all 8) | Add audit log + nav translation keys |
| `tests/services/audit-log-service.test.ts` | New test file |

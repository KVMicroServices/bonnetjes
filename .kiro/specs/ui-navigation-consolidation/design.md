# Design Document

## Overview

Consolidate the application's navigation from 4 header links (Dashboard, Admin Panel, Moderation, Platforms) down to 2 (Dashboard, Settings). The current admin panel becomes the new Dashboard, the old user dashboard is removed, user management moves to a new Settings page, and all moderation/platforms code is deleted.

## Architecture Changes

### Route Structure (Before → After)

| Before | After |
|--------|-------|
| `/dashboard` → User dashboard page | `/dashboard` → Redirects to `/admin` (Next.js redirect) |
| `/admin` → Admin panel (queue/stats/users tabs) | `/admin` → Dashboard (queue/stats tabs only) |
| `/admin/moderation` → Moderation page | Deleted |
| `/admin/platforms` → Platforms page | Deleted |
| `/admin/settings/automation` → Automation workflows | `/admin/settings/automation` → Unchanged |
| (none) | `/admin/settings` → New settings page with user management |

### Decision: Keep `/admin` as canonical route

The admin panel stays at `/admin` as the canonical URL. `/dashboard` gets a Next.js `redirect()` to `/admin`. This avoids duplicating the page component or maintaining two entry points. The header link text changes to "Dashboard" but points to `/admin`.

### Decision: Settings page location

Settings lives at `/admin/settings/page.tsx`. With automation removed, this page initially contains only user management but is designed to grow as more settings are added in the future.

## Components Affected

### 1. Header (`components/header.tsx`)

**Current**: Shows Dashboard, Admin Panel, Moderation, Platforms links for admins.
**New**: Shows Dashboard and Settings links for authenticated users. No admin-only gating on nav links (all authenticated users see both, but the pages themselves enforce admin access).

Navigation items:
- "Dashboard" → `/admin` (icon: `LayoutDashboard`)
- "Settings" → `/admin/settings` (icon: `Settings`)
- Sign Out button (unchanged)
- Language selector (unchanged)

### 2. Admin page (`app/admin/page.tsx`)

**Current**: Has 3 tabs — "queue", "stats", "users".
**Changes**:
- Remove the "users" tab button and its content panel
- Remove the `ManualDisableForm` component (it's review-disable functionality that now lives in the automated workflow)
- Update page title from "Admin Panel" to "Dashboard" via translation keys
- Keep "queue" and "stats" tabs

### 3. New Settings page (`app/admin/settings/page.tsx`)

New page containing:
- User management section (moved from admin page's "users" tab)
- Admin-only auth check with redirect

### 4. Dashboard redirect (`app/dashboard/page.tsx`)

Replace the entire user dashboard with a simple server component that redirects to `/admin`:
```typescript
import { redirect } from "next/navigation";
export default function DashboardPage() {
  redirect("/admin");
}
```

### 5. Review Queue — Rejection Reason Column

Add a "Reason" column to the receipt table in the admin page's queue tab. The column displays the `failureReason` field from each receipt. Empty when no reason exists. Uses existing `Admin.failureReason` translation key for the column header.

## Files to Delete

| Path | Reason |
|------|--------|
| `app/admin/moderation/page.tsx` | Feature removed |
| `app/admin/platforms/page.tsx` | Feature removed |
| `app/admin/settings/automation/page.tsx` | Feature removed |
| `app/api/reviews/locations/route.ts` | Only served platforms page |
| `app/api/reviews/location/[locationId]/route.ts` | Only served platforms page |
| `app/api/reviews/moderation/route.ts` | Only served moderation page |
| `app/api/reviews/moderate/route.ts` | Only served moderation page |
| `app/api/admin/automation/workflows/route.ts` | Automation CRUD |
| `app/api/admin/automation/workflows/[id]/route.ts` | Automation CRUD |
| `app/api/admin/automation/execute/route.ts` | Automation execution |
| `lib/automation/executor.ts` | Automation service |

## Files to Create

| Path | Purpose |
|------|---------|
| `app/admin/settings/page.tsx` | Settings page with user management |

## Files to Modify

| Path | Change |
|------|--------|
| `components/header.tsx` | Replace 4 admin links with 2 (Dashboard + Settings) |
| `app/admin/page.tsx` | Remove "users" tab, remove ManualDisableForm, add reason column |
| `app/dashboard/page.tsx` | Replace with redirect to `/admin` |
| `prisma/schema.prisma` | Remove `AutomationWorkflow` model |
| `messages/*.json` (all 8) | Update Header namespace, add Settings namespace, remove Moderation/Reviews/ReviewDisable/Automation namespaces |

## Database Migration

A new Prisma migration is needed to drop the `AutomationWorkflow` table:
```sql
DROP TABLE IF EXISTS "AutomationWorkflow";
```

## Translation Changes

### Header namespace (update)
```json
{
  "Header": {
    "dashboard": "Dashboard",
    "settings": "Settings",
    "signOut": "Sign Out",
    "signIn": "Sign In",
    "getStarted": "Get Started"
  }
}
```
Remove: `adminPanel`, `moderation`, `platforms`
Add: `settings`

### Admin namespace (update)
- Change `"title": "Admin Panel"` → `"title": "Dashboard"`
- Change `"subtitle"` to reflect new role
- Remove `users`-tab-specific keys: `userManagement`, `usersCount`, `roleUpdated`, `roleUpdatedDescription`, `roleUpdateFailed`, `roleUpdateFailedDescription`

### Settings namespace (new)
```json
{
  "Settings": {
    "title": "Settings",
    "subtitle": "Manage application settings",
    "userManagement": "User Management",
    "usersCount": "{count} users",
    "roleUpdated": "Role updated",
    "roleUpdatedDescription": "User is now {role}",
    "roleUpdateFailed": "Error",
    "roleUpdateFailedDescription": "Failed to update role"
  }
}
```

### Namespaces to remove entirely
- `Moderation` — all keys
- `Reviews` — all keys
- `ReviewDisable` — all keys (ManualDisableForm removed)
- `Automation` — all keys

## Security

- Settings page enforces admin role check (same pattern as current admin page)
- `/dashboard` redirect works for all authenticated users — the admin page itself handles non-admin redirect
- No new API routes introduced; existing `/api/admin/users` route unchanged

## Out of Scope

- Archive page (`/archive`) — unchanged, still accessible directly
- Review disable logic (`lib/review-disable/`) — unchanged, uses Kiyoh API directly
- Receipt sync API routes — unchanged
- Any database schema changes beyond dropping `AutomationWorkflow`

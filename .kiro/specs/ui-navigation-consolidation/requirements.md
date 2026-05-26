# Requirements Document

## Introduction

Consolidate the ReviewReceipts application navigation by removing the separate user dashboard page, renaming the admin panel to "Dashboard", moving user management to a new "Settings" page, and removing the unused Moderation and Platforms features entirely. The final header navigation contains only two items: "Dashboard" and "Settings". Additionally, the review queue gains a rejection reason column for better moderation context.

## Glossary

- **Header**: The sticky top navigation bar component (`components/header.tsx`) rendered on all authenticated pages
- **Dashboard**: The renamed admin panel page that serves as the primary receipt management interface, served at both `/admin` and `/dashboard`
- **Settings_Page**: A new page for application configuration, initially containing user management (moved from the admin panel's "Users" tab)
- **Admin_Panel**: The current admin page at `/admin/page.tsx` containing receipt queue, stats, and user management tabs
- **User_Dashboard**: The current user-facing dashboard page at `/dashboard/page.tsx` that will be replaced
- **Moderation_Page**: The current page at `/admin/moderation/page.tsx` for review moderation queue — to be removed
- **Platforms_Page**: The current page at `/admin/platforms/page.tsx` for review platform location data — to be removed
- **Review_Queue**: The receipt table in the Admin_Panel "queue" tab showing all receipts for moderation

## Requirements

### Requirement 1: Serve Dashboard at both routes

**User Story:** As a user, I want `/dashboard` to show the same admin panel as `/admin`, so that existing bookmarks and links continue to work.

#### Acceptance Criteria

1. WHEN a user navigates to `/dashboard`, THE Application SHALL serve the Dashboard page (the admin panel content)
2. WHEN a user navigates to `/admin`, THE Application SHALL serve the same Dashboard page
3. THE Application SHALL remove the old User_Dashboard page code and replace it with the Dashboard content at the `/dashboard` route

### Requirement 2: Rename Admin Panel to Dashboard in navigation

**User Story:** As a user, I want the admin panel to be called "Dashboard" in the header, so that the naming reflects its role as the primary management interface.

#### Acceptance Criteria

1. THE Header SHALL display "Dashboard" instead of "Admin Panel" as the navigation label linking to the Dashboard page
2. WHEN the rename is applied, THE Application SHALL update all 8 language files to replace the "Admin Panel" header translation with "Dashboard" in the Header namespace
3. THE Dashboard page internal heading SHALL also read "Dashboard" instead of "Admin Panel" across all 8 language files

### Requirement 3: Move Users tab to Settings page

**User Story:** As an admin, I want user management on a dedicated Settings page, so that configuration concerns are separated from the receipt review workflow.

#### Acceptance Criteria

1. THE Settings_Page SHALL be accessible at a dedicated route and display the user management functionality currently in the Admin_Panel "Users" tab
2. THE Header SHALL display a "Settings" navigation link that routes to the Settings_Page
3. WHEN the Users tab is moved, THE Dashboard SHALL no longer display the "Users" tab button
4. THE Settings_Page SHALL require admin role authentication, redirecting unauthenticated or non-admin users appropriately
5. WHEN the Settings_Page is created, THE Application SHALL add translation keys for the Settings page to all 8 language files

### Requirement 4: Remove Moderation, Platforms, and Automation features entirely

**User Story:** As a developer, I want to remove all Moderation, Platforms, and Automation code, so that unused features do not add maintenance burden or clutter the interface.

#### Acceptance Criteria

1. THE Header SHALL NOT display "Moderation" or "Platforms" navigation links in either desktop or mobile navigation
2. WHEN the features are removed, THE Application SHALL delete the Moderation_Page files at `app/admin/moderation/`
3. WHEN the features are removed, THE Application SHALL delete the Platforms_Page files at `app/admin/platforms/`
4. WHEN the features are removed, THE Application SHALL delete the Automation page at `app/admin/settings/automation/`
5. WHEN the features are removed, THE Application SHALL delete the API routes that exclusively served these pages (`/api/reviews/locations`, `/api/reviews/moderation`, `/api/reviews/moderate`, `/api/reviews/location/[locationId]`, and `/api/admin/automation/*`)
6. WHEN the features are removed, THE Application SHALL remove the automation executor service at `lib/automation/executor.ts`
7. WHEN the features are removed, THE Application SHALL remove the `AutomationWorkflow` model from the Prisma schema and create a migration to drop the table
8. WHEN the features are removed, THE Application SHALL remove any service-layer code, utility functions, or library modules that exclusively supported moderation or platforms functionality
9. WHEN the features are removed, THE Application SHALL remove the associated translation keys from all 8 language files (the "Moderation", "Reviews", "ReviewDisable", and "Automation" namespaces)
10. THE removal SHALL NOT affect the review disable logic in `lib/review-disable/` which uses the Kiyoh API directly

### Requirement 5: Add rejection reason to Review Queue

**User Story:** As an admin, I want to see the rejection reason for each receipt in the review queue, so that I have immediate context when moderating.

#### Acceptance Criteria

1. THE Review_Queue table SHALL display a "Reason" column showing the `failureReason` field for each receipt
2. WHEN a receipt has no failure reason, THE Review_Queue SHALL display an empty cell or dash for that entry
3. THE rejection reason column SHALL use translated failure reason labels consistent with the existing `ReceiptCard` namespace translations

### Requirement 6: Final header structure

**User Story:** As a user, I want a clean header with only "Dashboard" and "Settings" links, so that navigation is simple and focused.

#### Acceptance Criteria

1. WHILE a user is authenticated, THE Header SHALL display exactly two navigation links: "Dashboard" and "Settings"
2. WHILE a user is authenticated, THE Header SHALL continue to display the sign-out button and language selector
3. WHILE a user is not authenticated, THE Header SHALL continue to display "Sign In" and "Get Started" links
4. THE Header SHALL maintain its current responsive behavior with mobile menu support for the updated navigation items

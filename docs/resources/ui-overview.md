# UI Overview

**Bonnetjes (ReviewReceipts)** is a receipt verification platform for authenticating online reviews on Kiyoh/KlantenVertellen.

## Pages

### `/` (Home)
Just a redirect. Sends logged-in users to `/dashboard`, others to `/login`.

### `/login`
Standard email/password login form.

### `/signup`
Registration form (name, email, password, confirm password).

### `/dashboard`
The main user-facing page. Users can:
- Upload receipt images/PDFs (via drag-and-drop or Google Drive import)
- See all their uploaded receipts with status (pending, verified, rejected)
- View extracted data (shop name, date, amount) from OCR
- Preview receipt images
- See fraud risk scores and OCR confidence
- Approve/reject receipts (for admins viewing here)
- Copy a Dutch rejection email template to send to users whose receipts don't meet requirements
- Archive receipts
- Bulk-select receipts

### `/archive`
Shows archived receipts grouped by date, with expand/collapse per date group. Users can preview and download archived receipts.

### `/admin`
Admin dashboard with:
- Stats overview (total receipts, users, flagged items)
- Receipt moderation queue with filtering
- Approve/reject/flag actions
- Preview receipts, copy rejection emails
- Pagination

### `/admin/moderation`
Deeper moderation view pulling reviews directly from the Kiyoh/KlantenVertellen platforms. Shows review content, ratings, user info, and allows approve/reject/flag actions on the platform level.

### `/admin/reviews`
Browse reviews by location from the connected review platforms. Shows location stats (average rating, star distribution, review counts) and individual reviews per location.

### `/admin/settings/automation`
Configure browser automation workflows for the review platforms. Admins can create multi-step workflows (navigate, click, type, wait, screenshot, etc.) that automate actions on Kiyoh/KV. Workflows can be created, edited, run, and deleted.

## Shared Components

- **Header** — Navigation bar across all authenticated pages
- **ReceiptUpload** — Drag-and-drop upload component
- **GoogleDriveImport** — Import receipts from Google Drive
- **ReceiptCard / AdminReceiptCard** — Display receipt details with actions

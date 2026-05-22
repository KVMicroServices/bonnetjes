# Product: ReviewReceipts (Bonnetjes)

Receipt verification platform for authenticating online reviews. Users upload purchase receipts which are processed with AI-powered OCR and fraud detection to prove review authenticity.

## Core Capabilities

- **Receipt Upload & Storage**: Users upload receipt images/PDFs stored in S3-compatible storage (Cloudflare R2)
- **AI OCR Processing**: Extracts shop name, date, and amount from receipts using OpenAI-compatible API
- **Fraud Detection**: Perceptual hashing for duplicate detection, manipulation scoring, suspicious pattern flagging
- **Receipt Moderation**: Dashboard for reviewing, approving, rejecting, and flagging receipts
- **Review Platform Integration**: Connects to Kiyoh and KlantenVertellen review platforms via their APIs
- **Automation Workflows**: Configurable multi-step workflows for review platform operations
- **Google Drive Import**: Import receipts directly from Google Drive
- **Notifications**: In-app and email notifications for disputes, processing outcomes, mentions, and moderation events
- **Dispute Flow**: Customers can dispute rejected receipts by uploading new evidence via a tokenized link

## Access Model

All authenticated users have access to the full platform. There is no feature gating by role except for system settings.

- **All authenticated users**: Upload receipts, view dashboard, manage archive, moderate receipts, view analytics, manage reviews, receive notifications, configure personal notification preferences, view disputes
- **Admin-only**: System settings (SMTP configuration, OCR confidence thresholds, automation workflows, user role management, location whitelists)

The `role` field on the User model exists solely to control access to the `/api/admin/settings` endpoint and the admin settings UI. Do not add role checks to other routes or features unless explicitly requested.

## Deployment

Deployed on Railway via Docker. PostgreSQL database.

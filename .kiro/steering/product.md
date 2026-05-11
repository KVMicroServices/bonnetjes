# Product: ReviewReceipts (Bonnetjes)

Receipt verification platform for authenticating online reviews. Users upload purchase receipts which are processed with AI-powered OCR and fraud detection to prove review authenticity.

## Core Capabilities

- **Receipt Upload & Storage**: Users upload receipt images/PDFs stored in S3-compatible storage (Cloudflare R2)
- **AI OCR Processing**: Extracts shop name, date, and amount from receipts using OpenAI-compatible API
- **Fraud Detection**: Perceptual hashing for duplicate detection, manipulation scoring, suspicious pattern flagging
- **Admin Moderation**: Admin panel for reviewing, approving, rejecting, and flagging receipts
- **Review Platform Integration**: Connects to Kiyoh and KlantenVertellen review platforms via their APIs
- **Automation Workflows**: Configurable multi-step workflows for review platform operations
- **Google Drive Import**: Import receipts directly from Google Drive

## User Roles

- **User**: Uploads receipts, views dashboard, manages archive
- **Admin**: Moderates receipts, manages users, configures automation, views stats

## Deployment

Deployed on Railway via Docker. PostgreSQL database.

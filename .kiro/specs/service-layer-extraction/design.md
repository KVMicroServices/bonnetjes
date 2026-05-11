# Design Document

## Overview

Extract all inline business logic from route handlers into service modules under `lib/services/`. Write integration tests first as a safety net, then refactor. AI API integration tests are isolated from the main suite.

## Architecture

### Service Modules

Each service module exports plain functions that accept explicit dependencies (database client, storage client, etc.) as parameters. No singleton imports inside services.

```
lib/services/
├── receipt-service.ts       # Receipt CRUD, archiving, listing, fraud pipeline
├── ocr-service.ts           # LLM prompt construction, API call, result parsing, verification logic
├── auth-service.ts          # Login validation, signup, token refresh helpers
├── review-platform-service.ts  # Kiyoh/KV API: locations, reviews, moderation actions
├── drive-service.ts         # Google Drive token management, file listing, file download + import
├── automation-service.ts    # Workflow CRUD, execution delegation
├── admin-service.ts         # Stats aggregation, user management, receipt moderation
└── upload-service.ts        # Presigned URL generation with file type validation
```

### Dependency Injection Pattern

Services receive dependencies as a context object rather than importing singletons:

```typescript
// lib/services/receipt-service.ts
interface ReceiptServiceDependencies {
  database: PrismaClient;
  storage: StorageClient;
}

export function createReceipt(
  dependencies: ReceiptServiceDependencies,
  userId: string,
  input: CreateReceiptInput
) { ... }
```

This makes services testable with mocked dependencies without module-level mocking.

### Route Handler Pattern (After Extraction)

```typescript
// app/api/receipts/route.ts (after)
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as any).id;
  const body = await request.json();

  const receipt = await createReceipt(
    { database: prisma, storage: s3 },
    userId,
    body
  );

  return NextResponse.json(receipt, { status: 201 });
}
```

## Service Boundaries

### receipt-service.ts
- `listReceipts(deps, userId, isAdmin)` — filtered listing
- `getReceipt(deps, receiptId, userId, isAdmin)` — single receipt with access check
- `createReceipt(deps, userId, input)` — create + fraud detection pipeline
- `updateReceiptStatus(deps, receiptId, adminId, status, notes)` — admin moderation + action log
- `archiveReceipts(deps, receiptIds, userId, isAdmin)` — bulk archive
- `listArchivedReceipts(deps, userId, isAdmin)` — grouped by date
- `getDownloadUrl(deps, receiptId, userId, isAdmin)` — signed URL + admin action log

### ocr-service.ts
- `buildOcrMessages(fileBuffer, fileType, originalFilename)` — prompt + message construction (PDF vs image)
- `callOcrApi(messages, config)` — LLM API call (streaming or non-streaming)
- `parseOcrResult(rawJson)` — parse + validate extracted fields
- `determineVerificationStatus(ocrResult, isDuplicate, receiptDate)` — status logic
- `processReceiptOcr(deps, receiptId)` — full pipeline: fetch file → OCR → fraud update → DB persist

### auth-service.ts
- `validateCredentials(deps, email, password)` — bcrypt compare
- `registerUser(deps, input)` — Zod validation + hash + create
- `refreshGoogleToken(deps, accountId)` — OAuth token refresh + DB persist

### review-platform-service.ts
- `fetchLocations(source, token)` — get all locations from platform
- `fetchReviewsForLocation(source, locationId, options)` — reviews with ordering
- `moderateReview(source, action, payload)` — abuse/changerequest/respond
- `fetchPendingReviews(tokens)` — aggregate pending across all locations
- `fetchNotificationCount(tokens)` — locations with recent activity

### drive-service.ts
- `getAccessToken(deps, userId)` — token retrieval + refresh
- `listDriveFiles(accessToken, folderId, sharedWithMe)` — folders + files
- `importDriveFile(deps, userId, fileId, fileName, mimeType)` — download → S3 → receipt → OCR

### automation-service.ts
- `listWorkflows(deps)` — all workflows
- `getWorkflow(deps, workflowId)` — single with parsed steps
- `createWorkflow(deps, input)` — validate + create
- `updateWorkflow(deps, workflowId, input)` — partial update
- `deleteWorkflow(deps, workflowId)` — delete
- `executeWorkflow(deps, workflowId, variables, dryRun)` — load + credential injection + execute

### admin-service.ts
- `getDashboardStats(deps)` — aggregated counts + fraud stats
- `listUsers(deps)` — users with receipt counts
- `updateUserRole(deps, targetUserId, newRole)` — with super-admin protection

### upload-service.ts
- `generateUploadUrl(deps, fileName, contentType, isPublic)` — validate type + presign

## Test Architecture

### Main Suite (`npm test`)

Uses Vitest. All external dependencies mocked at module boundary.

```
tests/
├── services/
│   ├── receipt-service.test.ts
│   ├── ocr-service.test.ts
│   ├── auth-service.test.ts
│   ├── review-platform-service.test.ts
│   ├── drive-service.test.ts
│   ├── automation-service.test.ts
│   ├── admin-service.test.ts
│   └── upload-service.test.ts
├── routes/
│   ├── receipts.test.ts
│   ├── auth.test.ts
│   ├── admin.test.ts
│   ├── reviews.test.ts
│   ├── drive.test.ts
│   ├── automation.test.ts
│   └── upload.test.ts
└── lib/
    └── fraud-detection.test.ts
```

Mocking strategy:
- Prisma: mocked via `vi.mock("@/lib/db")` returning controlled data
- S3: mocked via `vi.mock("@/lib/s3")` returning fake buffers/URLs
- External APIs (OpenAI, Google, Kiyoh/KV): mocked via `vi.mock` on global `fetch` or service-level mocks
- bcrypt: mocked to return predictable results

### AI Integration Suite (`npm run test:ai`)

Separate Vitest config that only runs tests in `tests/ai-integration/`.

```
tests/ai-integration/
├── fixtures/
│   └── sample-receipt.jpg    # Generated fake receipt image
├── ocr-extraction.test.ts    # Real API call: sends fixture, validates JSON schema
└── vitest.config.ts          # Separate config (no mocks, requires AI_API_KEY)
```

### Package.json Scripts

```json
{
  "scripts": {
    "test": "vitest run",
    "test:ai": "vitest run --config tests/ai-integration/vitest.config.ts"
  }
}
```

### Vitest Configuration

Main config excludes `tests/ai-integration/`:

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    exclude: ["tests/ai-integration/**", "node_modules/**"]
  }
});
```

## Deduplication

The OCR logic currently exists in two places:
1. `app/api/receipts/[id]/ocr/route.ts` (streaming)
2. `app/api/drive/import/route.ts` (non-streaming, background)

Both will call `ocr-service.ts`. The service exposes both streaming and non-streaming variants.

Token refresh logic (Google OAuth) currently duplicated in `drive/files` and `drive/import` will be consolidated into `auth-service.ts`.

## Migration Strategy

1. Write integration tests against current route behavior (tests call route handlers directly via Next.js test utilities or mock `NextRequest`/`NextResponse`)
2. Extract services one domain at a time, running tests after each extraction
3. Route handlers become thin wrappers: parse request → call service → format response

## Constraints

- No behavior changes — external HTTP responses must remain identical
- No new dependencies beyond Vitest (test runner)
- Services must not import Next.js-specific modules (`NextRequest`, `NextResponse`, `getServerSession`)
- Auth checking stays in route handlers, not services

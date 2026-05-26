# Project Structure

```
bonnetjes/
├── app/                        # Next.js App Router
│   ├── layout.tsx              # Root layout (providers, fonts, metadata)
│   ├── page.tsx                # Landing page
│   ├── globals.css             # Global styles + Tailwind
│   ├── login/                  # Login page
│   ├── signup/                 # Signup page
│   ├── dashboard/              # User dashboard
│   ├── archive/                # Archived receipts
│   ├── admin/                  # Admin settings (only section requiring admin role)
│   │   ├── page.tsx            # Admin dashboard
│   │   ├── moderation/         # Receipt moderation
│   │   ├── reviews/            # Review management
│   │   └── settings/automation # Automation workflow config (admin-only)
│   └── api/                    # API routes (Route Handlers)
│       ├── auth/               # NextAuth + login endpoints
│       ├── receipts/           # Receipt CRUD, OCR, download
│       ├── upload/             # File upload
│       ├── drive/              # Google Drive import
│       ├── reviews/            # Review platform operations
│       ├── admin/              # Admin-scoped endpoints (settings require admin role, others auth-only)
│       │   ├── receipts/       # Admin receipt management
│       │   ├── reviews/        # Review notifications
│       │   ├── automation/     # Workflow CRUD + execution
│       │   ├── stats/          # Dashboard statistics
│       │   ├── settings/       # System settings (admin role required)
│       │   └── users/          # User management
│       └── health/             # Health check (Railway)
├── components/
│   ├── ui/                     # shadcn/ui primitives (do not edit)
│   ├── providers.tsx           # Client providers wrapper
│   ├── header.tsx              # App header
│   ├── receipt-card.tsx        # Receipt display card
│   ├── receipt-upload.tsx      # Upload component
│   └── google-drive-import.tsx # Drive import UI
├── lib/                        # Shared utilities & services
│   ├── db.ts                   # Prisma client singleton
│   ├── auth-options.ts         # NextAuth configuration
│   ├── s3.ts                   # S3 client & helpers
│   ├── aws-config.ts           # AWS/R2 configuration
│   ├── fraud-detection.ts      # Fraud scoring logic
│   ├── automation/executor.ts  # Workflow execution engine
│   ├── types.ts                # Shared TypeScript types
│   └── utils.ts                # General utilities (cn helper)
├── hooks/                      # Custom React hooks
│   └── use-toast.ts            # Toast notification hook
├── prisma/
│   ├── schema.prisma           # Database schema (source of truth)
│   └── migrations/             # Prisma migrations
├── scripts/
│   ├── docker-entrypoint.sh    # Container startup (migrations + start)
│   ├── seed.ts                 # Database seeder
│   ├── safe-seed.ts            # Idempotent seed wrapper
│   └── review.sh               # Review platform script
├── public/                     # Static assets
├── API DOCS/                   # Kiyoh/KV API documentation (PDFs)
└── docs/                       # Project documentation
```

## Key Conventions

- **API routes** use Next.js Route Handlers (`route.ts` files)
- **Pages** are React Server Components by default
- **Client components** use `"use client"` directive
- **Database access** goes through `lib/db.ts` (Prisma singleton)
- **Auth checks** use NextAuth `getServerSession` in API routes — check for authenticated session only, not role (except `/api/admin/settings`)
- **File storage** uses S3-compatible API via `lib/s3.ts`
- **UI components** from shadcn/ui are in `components/ui/` — add new ones via CLI, don't hand-edit
- **Access control**: All routes require authentication. Only `/api/admin/settings` additionally requires `role === "admin"`. Do not add admin role checks elsewhere unless explicitly asked.

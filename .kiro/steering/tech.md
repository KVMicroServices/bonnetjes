# Tech Stack

## Framework & Runtime

- **Next.js 14** (App Router, React Server Components)
- **React 18**
- **TypeScript** (strict mode)
- **Node.js 20** (Alpine in Docker)

## Database & ORM

- **PostgreSQL 16**
- **Prisma 6.7** (ORM, migrations, schema-first)
- Schema at `prisma/schema.prisma`

## UI & Styling

- **Tailwind CSS 3** with CSS variables
- **shadcn/ui** (Radix primitives, default style, neutral base color)
- **Lucide React** for icons
- **Framer Motion** for animations
- UI components live in `components/ui/` — do not edit these directly

## State & Data Fetching

- **Jotai** (atomic state)
- **Zustand** (store-based state)
- **TanStack React Query** (server state)
- **SWR** (some data fetching)
- **React Hook Form + Zod** (form validation)

## Authentication

- **NextAuth.js 4** with Prisma adapter
- Google OAuth + credentials provider
- JWT sessions
- Role stored in JWT, refreshed from DB on every request
- Admin role only gates system settings — all other features are available to every authenticated user

## Storage & Cloud

- **AWS SDK v3** (S3-compatible — Cloudflare R2)
- **Azure Blob Storage** (secondary/alternative)

## AI & OCR

- OpenAI-compatible API for receipt OCR extraction
- Configurable model and base URL via env vars

## Charts & Visualization

- **Recharts**, **Chart.js**, **Plotly.js**

## Common Commands

```bash
# Development
npm run dev          # Start dev server (localhost:3000)
npm run build        # Production build
npm run start        # Start production server
npm run lint         # ESLint

# Database
npx prisma generate          # Generate Prisma client
npx prisma migrate dev       # Run migrations (dev)
npx prisma migrate deploy    # Run migrations (production)
npx prisma db seed            # Seed database

# Docker
docker compose up -d          # Start full stack (app + postgres)
docker compose up database -d # Start only postgres

# Type checking (referenced in AGENTS.md exit checks)
npm run check        # Type check (if configured)
npm test             # Run tests
```

## Path Aliases

- `@/*` maps to project root (configured in tsconfig.json)

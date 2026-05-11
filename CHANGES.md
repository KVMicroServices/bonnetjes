# Changes

## [006] Auto-baseline existing databases on first migration

**What**: Entrypoint now catches P3005 (non-empty schema) and automatically marks the initial migration as applied before retrying, so existing databases transition to migrations without manual intervention.

## [005] Run database seed on staging startup

**What**: Entrypoint now runs `prisma db seed` when `NODE_ENV` is not `production`, so staging containers get seeded automatically on boot.

## [004] Run Prisma migrations on container startup

**What**: Added a shared entrypoint script that runs `prisma migrate deploy` before starting the app in both production and staging Docker targets.
**Files**: `scripts/docker-entrypoint.sh`, `Dockerfile`

## [003] Add missing CMD instructions to Dockerfile

**What**: Added `CMD` to both production and staging stages — containers were exiting immediately with code 0 because there was nothing to run.

## [002] Add health endpoint and update Railway config

**What**: Added `/api/health` endpoint that checks database connectivity; updated railway.toml to use it.
**Files**: app/api/health/route.ts, railway.toml

## [001] Add Docker and Docker Compose setup

**What**: Multi-stage Dockerfile (Alpine, Node 20, standalone output) and docker-compose with PostgreSQL.
**Decisions**:
- Used Alpine-based images for small footprint
- Next.js standalone output mode for minimal production image
- Added x86_64 Prisma binary target alongside existing ARM64 target
**Files**: Dockerfile, docker-compose.yml, .dockerignore, prisma/schema.prisma

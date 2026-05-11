# syntax=docker/dockerfile:1

# --- Base stage ---
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

# --- Dependencies stage ---
FROM base AS dependencies
COPY package.json package-lock.json .npmrc ./
COPY prisma ./prisma/
RUN npm ci

# --- Builder stage ---
FROM base AS builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_OUTPUT_MODE=standalone

RUN npx prisma generate
RUN npm run build

# --- Production stage (minimal, standalone output) ---
FROM base AS production
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Prisma CLI for migrations on startup
COPY --from=dependencies /app/node_modules/prisma ./node_modules/prisma
COPY --from=dependencies /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=dependencies /app/node_modules/.bin/prisma ./node_modules/.bin/prisma

COPY --chmod=755 scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]

# --- Staging stage (full install, migrations, seeding available) ---
FROM base AS staging
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/.npmrc ./.npmrc
COPY --from=builder /app/next.config.js ./next.config.js

COPY --chmod=755 scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "run", "start"]

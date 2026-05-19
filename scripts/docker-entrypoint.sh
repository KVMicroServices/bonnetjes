#!/bin/sh
set -e

INITIAL_MIGRATION="20260511112621_initial"

echo "Running Prisma migrations..."

# If migrate deploy fails due to non-empty schema (P3005), baseline the initial migration
if ! npx prisma migrate deploy 2>/tmp/migrate_output.txt; then
  if grep -q "P3005" /tmp/migrate_output.txt; then
    echo "Existing database detected, baselining initial migration..."
    npx prisma migrate resolve --applied "$INITIAL_MIGRATION"
    npx prisma migrate deploy
  else
    cat /tmp/migrate_output.txt
    exit 1
  fi
fi

if [ "$NODE_ENV" != "production" ]; then
  echo "Running database seed..."
  npx prisma db seed
fi

echo "Starting application..."
exec "$@"

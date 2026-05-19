#!/bin/sh
set -e

INITIAL_MIGRATION="20260511112621_initial"

echo "Running Prisma migrations..."

# If migrate deploy fails, handle known recoverable cases
if ! npx prisma migrate deploy 2>&1 | tee /tmp/migrate_output.txt; then
  if grep -q "P3005" /tmp/migrate_output.txt; then
    echo "Existing database detected (P3005), baselining initial migration..."
    npx prisma migrate resolve --applied "$INITIAL_MIGRATION"
    npx prisma migrate deploy
  elif grep -q "P3018" /tmp/migrate_output.txt && grep -q "already exists" /tmp/migrate_output.txt; then
    echo "Migration failed because relations already exist (P3018), baselining..."
    npx prisma migrate resolve --applied "$INITIAL_MIGRATION"
    npx prisma migrate deploy
  elif grep -q "P3009" /tmp/migrate_output.txt && grep -q "$INITIAL_MIGRATION" /tmp/migrate_output.txt; then
    echo "Previously failed initial migration detected (P3009), resolving..."
    npx prisma migrate resolve --rolled-back "$INITIAL_MIGRATION"
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

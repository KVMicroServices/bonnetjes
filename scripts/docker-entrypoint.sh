#!/bin/sh
set -e

echo "Running Prisma migrations..."
npx prisma migrate deploy

if [ "$NODE_ENV" != "production" ]; then
  echo "Running database seed..."
  npx prisma db seed
fi

echo "Starting application..."
exec "$@"

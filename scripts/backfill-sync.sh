#!/bin/bash
#
# Trigger a receipt sync backfill via the admin API.
#
# Usage:
#   ./scripts/backfill-sync.sh <tenantId> [--force] [--days N]
#
# Environment variables (or set in .env):
#   ADMIN_EMAIL     - Admin account email
#   ADMIN_PASSWORD  - Admin account password
#   APP_BASE_URL    - App URL (default: http://localhost:3000)
#
# Examples:
#   ./scripts/backfill-sync.sh 98
#   ./scripts/backfill-sync.sh 98 --force
#   ./scripts/backfill-sync.sh 98 --force --days 5

set -euo pipefail

# ─── Load .env if present ──────────────────────────────────────────────────────

if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

# ─── Parse arguments ──────────────────────────────────────────────────────────

TENANT_ID="${1:-}"
FORCE_FLAG="false"
DAYS=""

if [ -z "$TENANT_ID" ]; then
  echo "Usage: $0 <tenantId> [--force] [--days N]"
  echo ""
  echo "  tenantId   The tenant ID to backfill (number)"
  echo "  --force    Override the watermark guard"
  echo "  --days N   How many days to look back (default: 5)"
  exit 1
fi

shift
while [ $# -gt 0 ]; do
  case "$1" in
    --force)
      FORCE_FLAG="true"
      shift
      ;;
    --days)
      DAYS="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# ─── Configuration ────────────────────────────────────────────────────────────

BASE_URL="${APP_BASE_URL:-http://localhost:3000}"
EMAIL="${ADMIN_EMAIL:-}"
PASSWORD="${ADMIN_PASSWORD:-}"

if [ -z "$EMAIL" ] || [ -z "$PASSWORD" ]; then
  echo "Error: ADMIN_EMAIL and ADMIN_PASSWORD must be set."
  echo "Set them in your .env or export them before running this script."
  exit 1
fi

echo "═══════════════════════════════════════════════════════════════"
echo "  Receipt Sync Backfill"
echo "═══════════════════════════════════════════════════════════════"
echo "  Base URL:  $BASE_URL"
echo "  Tenant:    $TENANT_ID"
echo "  Force:     $FORCE_FLAG"
echo "  Days:      ${DAYS:-5 (default)}"
echo "  Email:     $EMAIL"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# ─── Step 1: Authenticate via NextAuth credentials ────────────────────────────

echo "┌─────────────────────────────────────────────────────────────"
echo "│ Step 1: Fetching CSRF token..."
echo "└─────────────────────────────────────────────────────────────"

CSRF_RESPONSE=$(curl -s -v -c /tmp/backfill-cookies.txt \
  "$BASE_URL/api/auth/csrf" 2>&1)

echo "$CSRF_RESPONSE"
echo ""

CSRF_TOKEN=$(echo "$CSRF_RESPONSE" | grep -o '"csrfToken":"[^"]*"' | cut -d'"' -f4)

if [ -z "$CSRF_TOKEN" ]; then
  echo "ERROR: Failed to extract CSRF token from response."
  exit 1
fi

echo "✓ CSRF token: ${CSRF_TOKEN:0:20}..."
echo ""

echo "┌─────────────────────────────────────────────────────────────"
echo "│ Step 2: Signing in with credentials..."
echo "└─────────────────────────────────────────────────────────────"

SIGNIN_RESPONSE=$(curl -s -v -w "\n--- HTTP_CODE: %{http_code} ---\n" \
  -b /tmp/backfill-cookies.txt \
  -c /tmp/backfill-cookies.txt \
  -X POST "$BASE_URL/api/auth/callback/credentials" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "csrfToken=$CSRF_TOKEN&email=$EMAIL&password=$PASSWORD" 2>&1)

echo "$SIGNIN_RESPONSE"
echo ""

SIGNIN_HTTP_CODE=$(echo "$SIGNIN_RESPONSE" | grep "HTTP_CODE:" | grep -o '[0-9]*')

if [ "$SIGNIN_HTTP_CODE" != "302" ] && [ "$SIGNIN_HTTP_CODE" != "200" ]; then
  echo "ERROR: Authentication failed (HTTP $SIGNIN_HTTP_CODE)."
  echo "Check your ADMIN_EMAIL and ADMIN_PASSWORD."
  rm -f /tmp/backfill-cookies.txt
  exit 1
fi

echo "✓ Authenticated (HTTP $SIGNIN_HTTP_CODE)"
echo ""

# Show the session cookie for debugging
echo "┌─────────────────────────────────────────────────────────────"
echo "│ Session cookies:"
echo "└─────────────────────────────────────────────────────────────"
cat /tmp/backfill-cookies.txt
echo ""
echo ""

# ─── Step 3: Verify session works ────────────────────────────────────────────

echo "┌─────────────────────────────────────────────────────────────"
echo "│ Step 3: Verifying session (GET /api/auth/session)..."
echo "└─────────────────────────────────────────────────────────────"

SESSION_RESPONSE=$(curl -s -v \
  -b /tmp/backfill-cookies.txt \
  "$BASE_URL/api/auth/session" 2>&1)

echo "$SESSION_RESPONSE"
echo ""

# ─── Step 4: Check health ────────────────────────────────────────────────────

echo "┌─────────────────────────────────────────────────────────────"
echo "│ Step 4: Checking sync service health..."
echo "└─────────────────────────────────────────────────────────────"

HEALTH_RESPONSE=$(curl -s -v -w "\n--- HTTP_CODE: %{http_code} ---\n" \
  -b /tmp/backfill-cookies.txt \
  "$BASE_URL/api/admin/receipt-sync/health" 2>&1)

echo "$HEALTH_RESPONSE"
echo ""

# ─── Step 5: Trigger backfill ─────────────────────────────────────────────────

echo "┌─────────────────────────────────────────────────────────────"
echo "│ Step 5: Triggering backfill (tenant=$TENANT_ID, force=$FORCE_FLAG, days=${DAYS:-default})..."
echo "└─────────────────────────────────────────────────────────────"

if [ -n "$DAYS" ]; then
  BACKFILL_PAYLOAD="{\"tenantId\": $TENANT_ID, \"force\": $FORCE_FLAG, \"days\": $DAYS}"
else
  BACKFILL_PAYLOAD="{\"tenantId\": $TENANT_ID, \"force\": $FORCE_FLAG}"
fi

echo "  Request body: $BACKFILL_PAYLOAD"
echo ""

# Start tailing docker logs in the background so we see sync progress
DOCKER_LOG_PID=""
if command -v docker &> /dev/null; then
  docker compose logs -f --since 0s app 2>/dev/null &
  DOCKER_LOG_PID=$!
fi

BACKFILL_RESPONSE=$(curl -s -w "\n--- HTTP_CODE: %{http_code} ---\n" \
  -b /tmp/backfill-cookies.txt \
  -X POST "$BASE_URL/api/admin/receipt-sync/backfill" \
  -H "Content-Type: application/json" \
  -d "$BACKFILL_PAYLOAD" 2>&1)

# Stop docker log tail
if [ -n "$DOCKER_LOG_PID" ]; then
  kill "$DOCKER_LOG_PID" 2>/dev/null || true
  wait "$DOCKER_LOG_PID" 2>/dev/null || true
fi

echo ""
echo "$BACKFILL_RESPONSE"
echo ""

BACKFILL_CODE=$(echo "$BACKFILL_RESPONSE" | grep "HTTP_CODE:" | grep -o '[0-9]*')

# ─── Summary ──────────────────────────────────────────────────────────────────

echo "═══════════════════════════════════════════════════════════════"
echo "  Result: HTTP $BACKFILL_CODE"
echo "═══════════════════════════════════════════════════════════════"

# Try to pretty-print the JSON body (last non-empty line before HTTP_CODE)
BACKFILL_BODY=$(echo "$BACKFILL_RESPONSE" | grep "^{" | tail -1)
if [ -n "$BACKFILL_BODY" ]; then
  echo ""
  echo "$BACKFILL_BODY" | python3 -m json.tool 2>/dev/null || echo "$BACKFILL_BODY"
fi

# ─── Cleanup ──────────────────────────────────────────────────────────────────

rm -f /tmp/backfill-cookies.txt

echo ""
if [ "$BACKFILL_CODE" = "200" ]; then
  echo "✓ Backfill completed successfully."
  exit 0
elif [ "$BACKFILL_CODE" = "409" ]; then
  echo "⚠ Watermark is already recent. Use --force to override."
  exit 1
else
  echo "✗ Backfill failed."
  exit 1
fi

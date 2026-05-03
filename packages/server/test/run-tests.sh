#!/usr/bin/env bash
# Run all tests with a single shared server instance.
# Usage: bash test/run-tests.sh [extra node --test flags...]

set -e
cd "$(dirname "$0")/.."

# Per-worktree test DB: <leaf>_<8-char-hash>_test. Mirrors src/db/pool.ts.
if [ -z "${PGDATABASE:-}" ]; then
  if WT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null); then
    WT_NAME=$(basename "$WT_ROOT" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/_/g; s/^_+|_+$//g')
    WT_HASH=$(printf '%s' "$WT_ROOT" | sha256sum | cut -c1-8)
    PGDATABASE="${WT_NAME:-twnr}_${WT_HASH}_test"
  else
    PGDATABASE="twnr_test"
  fi
fi
export PGDATABASE
export PGUSER="${PGUSER:-twnr_user}"
export PGPASSWORD="${PGPASSWORD:-twnr_pass}"
export PGHOST="${PGHOST:-localhost}"
export JWT_SECRET="test-jwt-secret"
export ADMIN_API_KEY="test-admin-key"
export WS_ALLOWED_ORIGINS="http://localhost:3001"
export DISABLE_RATE_LIMIT=1
export PORT=3001

PROJECT_ROOT="$(pwd)"

# Create the test DB if missing (Postgres has no CREATE DATABASE IF NOT EXISTS).
if ! psql -h "$PGHOST" -U "$PGUSER" -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname='$PGDATABASE'" 2>/dev/null | grep -q 1; then
  echo "==> Creating test DB: $PGDATABASE"
  psql -h "$PGHOST" -U "$PGUSER" -d postgres -c "CREATE DATABASE \"$PGDATABASE\""
fi

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill -9 "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "==> Generating test universe..."
UNIVERSE_DIR=$(mktemp -d)
node scripts/twnr-bigbang.js "$UNIVERSE_DIR" --sectors 100 --seed 42

echo "==> Importing universe..."
# Drop old tables
psql -h "${PGHOST:-localhost}" -d "$PGDATABASE" -U "$PGUSER" \
  -f "$PROJECT_ROOT/scripts/drop-all-tables.sql" >/dev/null 2>&1

node scripts/importUniverse.js "$UNIVERSE_DIR" --force
rm -rf "$UNIVERSE_DIR"

# Fix sequences
psql -h "${PGHOST:-localhost}" -d "$PGDATABASE" -U "$PGUSER" -c \
  "SELECT setval('universes_id_seq', COALESCE((SELECT MAX(id) FROM universes), 0) + 1);
   SELECT setval('sectors_id_seq', COALESCE((SELECT MAX(id) FROM sectors), 0) + 1);
   SELECT setval('ports_id_seq', COALESCE((SELECT MAX(id) FROM ports), 0) + 1)" >/dev/null 2>&1

# Kill anything already on our test port
fuser -k "${PORT}/tcp" 2>/dev/null || true

echo "==> Starting server..."
node dist/server.js &
SERVER_PID=$!

# Wait for server to be ready
for i in $(seq 1 30); do
  if curl -s http://localhost:3001/api/ships >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "==> Running tests..."
node --test --test-concurrency=1 "$@" $(ls test/*.test.mjs | grep -v ratelimit)

# Run rate-limit tests in a second pass with rate limiting enabled
echo "==> Restarting server with rate limiting enabled..."
kill -9 "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true
sleep 1

unset DISABLE_RATE_LIMIT

fuser -k "${PORT}/tcp" 2>/dev/null || true
node dist/server.js &
SERVER_PID=$!

for i in $(seq 1 30); do
  if curl -s http://localhost:3001/api/ships >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "==> Running rate-limit tests..."
node --test --test-concurrency=1 "$@" test/ratelimit.test.mjs

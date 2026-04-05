#!/usr/bin/env bash
# Run all tests with a single shared server instance.
# Usage: bash test/run-tests.sh [extra node --test flags...]

set -e
cd "$(dirname "$0")/.."

export PGDATABASE="${PGDATABASE:-twnr_test}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-}"
export JWT_SECRET="test-jwt-secret"
export ADMIN_API_KEY="test-admin-key"
export WS_ALLOWED_ORIGINS="http://localhost:3000"

PROJECT_ROOT="$(pwd)"

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "==> Generating test universe..."
UNIVERSE_DIR=$(mktemp -d)
node scripts/twnr-bigbang.js "$UNIVERSE_DIR" --sectors 100 --seed 42

echo "==> Importing universe..."
# Drop old tables
psql -h "${PGHOST:-localhost}" -d "$PGDATABASE" -U "$PGUSER" -c "
  DROP TABLE IF EXISTS planet_collisions CASCADE;
  DROP TABLE IF EXISTS planets CASCADE;
  DROP TABLE IF EXISTS visited_sectors CASCADE;
  DROP TABLE IF EXISTS player_ships CASCADE;
  DROP TABLE IF EXISTS ship_cargo CASCADE;
  DROP TABLE IF EXISTS ports CASCADE;
  DROP TABLE IF EXISTS warps CASCADE;
  DROP TABLE IF EXISTS players CASCADE;
  DROP TABLE IF EXISTS sectors CASCADE;
  DROP TABLE IF EXISTS universes CASCADE;
  DROP TABLE IF EXISTS users CASCADE;
" >/dev/null 2>&1

node scripts/importUniverse.js "$UNIVERSE_DIR" --force
rm -rf "$UNIVERSE_DIR"

# Fix sequences
psql -h "${PGHOST:-localhost}" -d "$PGDATABASE" -U "$PGUSER" -c \
  "SELECT setval('universes_id_seq', COALESCE((SELECT MAX(id) FROM universes), 0) + 1)" >/dev/null 2>&1

echo "==> Starting server..."
node dist/server.js &
SERVER_PID=$!

# Wait for server to be ready
for i in $(seq 1 30); do
  if curl -s http://localhost:3000/api/ships >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "==> Running tests..."
node --test --test-concurrency=1 "$@" test/*.test.mjs

#!/usr/bin/env bash
# Run all tests with a single shared server instance.
# Usage: bash test/run-tests.sh [extra node --test flags...]

set -e
cd "$(dirname "$0")/.."

export PGDATABASE="${PGDATABASE:-twnr_test}"
export PGUSER="${PGUSER:-twnr_user}"
export PGPASSWORD="${PGPASSWORD:-twnr_pass}"
export JWT_SECRET="test-jwt-secret"
export ADMIN_API_KEY="test-admin-key"
export WS_ALLOWED_ORIGINS="http://localhost:3001"
export DISABLE_RATE_LIMIT=1
export PORT=3001

PROJECT_ROOT="$(pwd)"

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
psql -h "${PGHOST:-localhost}" -d "$PGDATABASE" -U "$PGUSER" -c "
  DROP TABLE IF EXISTS news CASCADE;
  DROP TABLE IF EXISTS visited_ports CASCADE;
  DROP TABLE IF EXISTS sector_beacons CASCADE;
  DROP TABLE IF EXISTS sector_mines CASCADE;
  DROP TABLE IF EXISTS command_log CASCADE;
  DROP TABLE IF EXISTS menu_command CASCADE;
  DROP TABLE IF EXISTS command CASCADE;
  DROP TABLE IF EXISTS sector_drones CASCADE;
  DROP TABLE IF EXISTS planet_collisions CASCADE;
  DROP TABLE IF EXISTS planets CASCADE;
  DROP TABLE IF EXISTS planet_types CASCADE;
  DROP TABLE IF EXISTS visited_sectors CASCADE;
  DROP TABLE IF EXISTS ship_hardware CASCADE;
  DROP TABLE IF EXISTS ships CASCADE;
  DROP TABLE IF EXISTS corporations CASCADE;
  DROP TABLE IF EXISTS ship_type_hardware CASCADE;
  DROP TABLE IF EXISTS ship_types_edits CASCADE;
  DROP TABLE IF EXISTS planet_types_edits CASCADE;
  DROP TABLE IF EXISTS ship_types CASCADE;
  DROP TABLE IF EXISTS hardware_price CASCADE;
  DROP TABLE IF EXISTS hardware_item CASCADE;
  DROP TABLE IF EXISTS ports CASCADE;
  DROP TABLE IF EXISTS warps CASCADE;
  DROP TABLE IF EXISTS players CASCADE;
  DROP TABLE IF EXISTS sectors CASCADE;
  DROP TABLE IF EXISTS universes CASCADE;
  DROP TABLE IF EXISTS edits CASCADE;
  DROP TABLE IF EXISTS users CASCADE;
  DROP TABLE IF EXISTS menu CASCADE;
" >/dev/null 2>&1

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

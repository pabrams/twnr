#!/bin/sh
set -e

# Manual one-shot: SEED_UNIVERSE=1 generates and imports universe data.
if [ "$SEED_UNIVERSE" = "1" ]; then
  echo "Seeding universe..."
  node packages/server/scripts/twnr-bigbang.js packages/server/data/universe/ --sectors 500 --seed 42
  node packages/server/scripts/importUniverse.js packages/server/data/universe --force
  echo "Seed complete."
fi

exec "$@"

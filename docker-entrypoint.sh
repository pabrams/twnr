#!/bin/sh
set -e

# On first run, generate and import universe seed data
if [ "$SEED_UNIVERSE" = "1" ]; then
  echo "Seeding universe..."
  node packages/server/scripts/twnr-bigbang.js packages/server/data/universe/ --sectors 500 --seed 42
  node packages/server/scripts/importUniverse.js packages/server/data/universe --force
  echo "Seed complete."
fi

exec "$@"

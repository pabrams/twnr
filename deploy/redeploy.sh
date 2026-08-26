#!/usr/bin/env bash
#
# One-command redeploy: push local commits, SSH to the VM, pull, rebuild,
# and tail logs. Run from the repo root on your dev machine.
#
# Usage:
#   ./deploy/redeploy.sh [--skip-push] [--no-tail] [--reset-db] [--seed]
#
# --reset-db   Drop all DB tables before starting the new app container.
#              connectDB() recreates the schema fresh on first connect.

# --seed       After the app is up, run the universe seeder once.

set -euo pipefail

ZONE="us-central1-a"
INSTANCE="twnr"
COMPOSE_FILE="docker-compose.production.yml"
ENV_FILE=".env.production"

skip_push=0
tail_logs=1
reset_db=0
seed_universe=0
for arg in "$@"; do
  case "$arg" in
    --skip-push) skip_push=1 ;;
    --no-tail)   tail_logs=0 ;;
    --reset-db)  reset_db=1 ;;
    --seed)      seed_universe=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

branch=$(git rev-parse --abbrev-ref HEAD)

if [[ "$skip_push" -eq 0 ]]; then
  echo "==> Pushing $branch to origin"
  git push origin "$branch"
fi

echo "==> Redeploying on $INSTANCE ($ZONE)"

gcloud compute ssh "$INSTANCE" --zone="$ZONE" --command="bash -s" <<EOF
set -euo pipefail
cd ~/twnr

git fetch --prune origin
git reset --hard
git checkout -B "$branch" "origin/$branch"
compose() {
  docker run --rm \\
    -v /var/run/docker.sock:/var/run/docker.sock \\
    -v "\$PWD:\$PWD" -w "\$PWD" \\
    --env-file $ENV_FILE \\
    docker:cli \\
    compose -f $COMPOSE_FILE "\$@"
}
compose down --remove-orphans
compose build app

# Bring up just the db first if we need to run pre-app data ops.
if [[ "$reset_db" -eq 1 || "$seed_universe" -eq 1 ]]; then
  compose up -d db
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if compose ps db | grep -q "(healthy)"; then break; fi
    sleep 2
  done
fi

if [[ "$reset_db" -eq 1 ]]; then
  echo "==> Dropping all tables (--reset-db)"
  compose run --rm app node packages/server/scripts/deleteDatabase.js
fi

if [[ "$seed_universe" -eq 1 ]]; then
  echo "==> Seeding universe (--seed)"
  compose run --rm app sh -c '\
    node packages/server/scripts/twnr-bigbang.js packages/server/data/universe/ --sectors 2000 --seed 42 && \
    node packages/server/scripts/importUniverse.js packages/server/data/universe --force'
fi

compose up -d
docker ps --format 'table {{.Names}}\t{{.Status}}'

if [[ "$tail_logs" -eq 1 ]]; then
  echo "==> Tailing app logs (Ctrl+C to stop)"
  docker logs -f --tail=50 twnr-app-1 || true
fi
EOF

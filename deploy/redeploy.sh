#!/usr/bin/env bash
#
# One-command redeploy: push local commits, SSH to the VM, pull, rebuild,
# and tail logs. Run from the repo root on your dev machine.
#
# Usage:
#   ./deploy/redeploy.sh [--skip-push] [--no-tail]

set -euo pipefail

ZONE="us-central1-a"
INSTANCE="twnr"
COMPOSE_FILE="docker-compose.production.yml"
ENV_FILE=".env.production"

skip_push=0
tail_logs=1
for arg in "$@"; do
  case "$arg" in
    --skip-push) skip_push=1 ;;
    --no-tail)   tail_logs=0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

if [[ "$skip_push" -eq 0 ]]; then
  branch=$(git rev-parse --abbrev-ref HEAD)
  echo "==> Pushing $branch to origin"
  git push origin "$branch"
fi

echo "==> Redeploying on $INSTANCE ($ZONE)"

# The heredoc runs on the VM. Uses docker:cli image so we don't depend on
# a host-installed compose (COS has no writable+exec path for plugins).
gcloud compute ssh "$INSTANCE" --zone="$ZONE" --command="bash -s" <<EOF
set -euo pipefail
cd ~/twnr
git pull --ff-only
docker run --rm \\
  -v /var/run/docker.sock:/var/run/docker.sock \\
  -v "\$PWD:\$PWD" -w "\$PWD" \\
  --env-file $ENV_FILE \\
  docker:cli \\
  compose -f $COMPOSE_FILE up -d --build
docker ps --format 'table {{.Names}}\t{{.Status}}'
EOF

if [[ "$tail_logs" -eq 1 ]]; then
  echo "==> Tailing app logs (Ctrl+C to stop)"
  gcloud compute ssh "$INSTANCE" --zone="$ZONE" --command="docker logs -f --tail=50 twnr-app-1"
fi

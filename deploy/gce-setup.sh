#!/usr/bin/env bash
#
# One-time setup: creates a free-tier GCE VM and deploys twnr.
#
# Prerequisites:
#   - gcloud CLI installed and authenticated (gcloud auth login)
#   - A GCP project with billing enabled (required even for free tier)
#
# Usage:
#   ./deploy/gce-setup.sh <GCP_PROJECT_ID>

set -euo pipefail

PROJECT="${1:?Usage: $0 <GCP_PROJECT_ID>}"
ZONE="us-central1-a"          # free tier eligible
INSTANCE="twnr"
MACHINE="e2-micro"            # free tier: 1 per billing account

echo "==> Setting project to $PROJECT"
gcloud config set project "$PROJECT"

echo "==> Enabling Compute Engine API (if not already)"
gcloud services enable compute.googleapis.com

echo "==> Creating firewall rule for HTTP"
gcloud compute firewall-rules create allow-http \
  --allow tcp:80 \
  --target-tags http-server \
  --description "Allow HTTP" \
  2>/dev/null || echo "    (firewall rule already exists)"

echo "==> Creating VM: $INSTANCE ($MACHINE in $ZONE)"
gcloud compute instances create "$INSTANCE" \
  --zone="$ZONE" \
  --machine-type="$MACHINE" \
  --image-family=cos-stable \
  --image-project=cos-cloud \
  --boot-disk-size=30GB \
  --tags=http-server \
  --metadata=startup-script='#!/bin/bash
    # Install docker-compose (cos has docker but not compose)
    if ! command -v docker-compose &>/dev/null; then
      COMPOSE_VERSION=$(curl -s https://api.github.com/repos/docker/compose/releases/latest | grep tag_name | cut -d\" -f4)
      curl -L "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
      chmod +x /usr/local/bin/docker-compose
    fi'

IP=$(gcloud compute instances describe "$INSTANCE" --zone="$ZONE" --format='get(networkInterfaces[0].accessConfigs[0].natIP)')

echo ""
echo "==> VM created!"
echo "    External IP: $IP"
echo ""
echo "Next steps:"
echo "  1. SSH in:  gcloud compute ssh $INSTANCE --zone=$ZONE"
echo "  2. Clone:   git clone https://github.com/pabrams/twnr.git && cd twnr"
echo "  3. Create:  cp .env.production.example .env.production"
echo "     Edit .env.production with real secrets (openssl rand -hex 32)"
echo "  4. Start:   docker-compose -f docker-compose.production.yml --env-file .env.production up -d --build"
echo "  5. Seed:    docker-compose -f docker-compose.production.yml exec -e SEED_UNIVERSE=1 app /app/docker-entrypoint.sh echo done"
echo "  6. Visit:   http://$IP"

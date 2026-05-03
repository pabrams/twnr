# TWNR

A web-based remake of the classic Trade Wars 2002 bulletin board system door game.

## Setup

These steps should work on Arch-based Linux distros.

### 1. Install PostgreSQL

```bash
sudo pacman -S postgresql
sudo -u postgres initdb -D /var/lib/postgres/data
sudo systemctl enable --now postgresql
```

### 2. Create the user

```bash
sudo -u postgres psql -c "CREATE USER twnr_user WITH CREATEDB PASSWORD 'twnr_pass';"
```

The server auto-creates a per-worktree database on first boot
(`<leaf>_<8-char-hash>`, e.g. `twnr_fc44cb23`), so the user needs `CREATEDB`.
If you already created `twnr_user` without it:

```bash
sudo -u postgres psql -c "ALTER USER twnr_user CREATEDB;"
```

To pin a specific database name instead, set `PGDATABASE=<name>` in
`packages/server/.env` and pre-create it manually.

### 3. Install, generate env, and build

```bash
pnpm install
cd packages/server
pnpm run generate-env
cd ../..
pnpm run build
```

### 4. Seed the universe

```bash
cd packages/server
pnpm run db:seed
```

### 5. Run tests

```bash
pnpm test
```

### 6. Start the server and client

```bash
pnpm dev
```

You should see:
```
Server listening on port 3000
```

Visit http://localhost:5173 and register.

## Example deployment to GCP

This walks through deploying TWNR to a free-tier Google Cloud Compute Engine VM. The current deploy is at `http://136.111.192.254`.

There are no actual GCP dependencies in the app - this is just an example hosting scenario, and the single-VM setup is not intended for anything more than a couple dozen users.

### Prerequisites

- A Google account
- [`gcloud` CLI](https://cloud.google.com/sdk/docs/install) installed locally
- Access to <https://console.cloud.google.com> in a browser (for the billing step)

### 1. Authenticate

```bash
gcloud auth login
```

Opens a browser; approve the requested scopes. Verify:

```bash
gcloud auth list
```

On first `gcloud compute ssh` (later), gcloud generates `~/.ssh/google_compute_engine` and prompts for an optional passphrase. Blank is fine on a personal machine.

### 2. Create a GCP project

Either via the browser console or CLI. Pick a globally-unique project ID.

```bash
gcloud projects create <PROJECT_ID>
gcloud config set project <PROJECT_ID>
```

### 3. Link a billing account

Free-tier resources still require billing to be attached. From the browser console: **Billing → Link a billing account** (create one if needed) → select your new project.

Nothing else will work until this is done — the next step (`gcloud services enable ...`) fails without billing. An `e2-micro` in `us-central1`/`us-west1`/`us-east1` is $0/mo within the always-free quota, but the billing account must exist.

### 4. Provision the VM

From this repo:

```bash
./deploy/gce-setup.sh <PROJECT_ID>
```

This enables the Compute Engine API, creates a firewall rule opening :80 to `http-server`-tagged instances, and provisions a `twnr` VM (e2-micro, Container-Optimized OS stable, `us-central1-a`, 30 GB disk). The script prints the external IP.

### 5. First-time VM setup

SSH in:

```bash
gcloud compute ssh twnr --zone=us-central1-a
```

Clone the repo and switch to the deploy branch:

```bash
git clone https://github.com/pabrams/twnr.git
cd twnr
git checkout gcp
```

Create the production env file from the tracked template:

```bash
cp .env.production.example .env.production
```

Edit `.env.production` and replace every `change-me-...` placeholder. Generate secrets with:

```bash
openssl rand -hex 32   # POSTGRES_PASSWORD
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 32   # ADMIN_API_KEY
```

Exit the VM.

### 6. Deploy the app

From the repo root on your local machine:

```bash
./deploy/redeploy.sh --skip-push
```

This SSHes in, pulls the latest code, and runs `docker compose` via the official `docker:cli` container (Container-Optimized OS has no writable+exec path for host binaries like `docker-compose`). First build takes 5–15 minutes on an `e2-micro`; subsequent builds are much faster because the install layers stay cached.

When you see `Server listening on port 3000`, visit `http://<EXTERNAL-IP>`.

### 7. Create your admin user

Register an account in the browser UI. Then promote yourself:

```bash
gcloud compute ssh twnr --zone=us-central1-a --command="docker exec twnr-app-1 node packages/server/scripts/promote-admin.mjs you@email.com"
```

Log out and back in — the role is baked into the JWT, so a new token is needed.

For any *future* admin users, register them with the admin key header and skip the promotion step:

```bash
# On the VM, so ADMIN_API_KEY isn't in your local shell history
source .env.production
curl -X POST http://localhost/api/auth/register \
  -H "Content-Type: application/json" \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -d '{"name":"NewAdmin","email":"admin@email","password":"strong-password"}'
```

### 8. (Optional) Seed a universe

Universes are not created automatically.

```bash
gcloud compute ssh twnr --zone=us-central1-a --command="docker exec -e SEED_UNIVERSE=1 twnr-app-1 /app/docker-entrypoint.sh true"
```

### Redeploying code changes

After committing to the `gcp` branch:

```bash
./deploy/redeploy.sh                # push + pull + rebuild + tail logs
./deploy/redeploy.sh --skip-push    # already pushed
./deploy/redeploy.sh --no-tail      # fire-and-forget
```

### Staging vs. production

The current deploy is a single environment, suitable as staging once you have real users. For prod, spin up a second VM (different instance name, zone, or project — whichever feels cleanest) with the same `./deploy/gce-setup.sh` + `./deploy/redeploy.sh` flow. Note that the always-free `e2-micro` quota is 1 per billing account, so the second VM is billed (still cheap, ~\$6/mo at `e2-micro` list).

Copy `deploy/redeploy.sh` to `deploy/redeploy-prod.sh` and change the constants at the top (`INSTANCE`, `ZONE`) to target the prod VM. Databases are fully independent between environments.

## Documentation

The `docs/` folder is generated during `pnpm build` (or directly via `pnpm docs`). It contains:

- **`index.html`** — Protocol reference with every WebSocket message type, showing the exact wire-format JSON including resolved string literal `type` discriminators. Has a sidebar treeview for client and server messages.
- **`client-messages.schema.json`** / **`server-messages.schema.json`** — JSON Schema files generated from the TypeScript source types in `packages/shared/`.

Do not edit these files by hand — they are regenerated from the TypeScript source on every build.

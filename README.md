# TWNR

A web-based remake of the classic Trade Wars 2002 bulletin board system door game.

## Setup

These steps should work on Arch-based Linux distros.

### 0. Pre-Requisites

Node and pnpm.

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

## Documentation

The `docs/` folder is generated during `pnpm build` (or directly via `pnpm docs`). It contains:

- **`index.html`** — Protocol reference with every WebSocket message type, showing the exact wire-format JSON including resolved string literal `type` discriminators. Has a sidebar treeview for client and server messages.
- **`client-messages.schema.json`** / **`server-messages.schema.json`** — JSON Schema files generated from the TypeScript source types in `packages/shared/`.

Do not edit these files by hand — they are regenerated from the TypeScript source on every build.

## Deployment

Refer to ./DEPLOY.md


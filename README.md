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

### ER diagram

`pnpm erd` generates `docs/twnr.erd.json`, an entity-relationship diagram of the database, for
[erd-editor](https://github.com/dineug/erd-editor). It is not part of `pnpm build`.

`packages/server/src/db/schema.ts` stays the source of truth. The script runs its `connectDB()` against a
throwaway database (`twnr_erd_tmp`, dropped before and after each run, so your own databases are
never touched), dumps the schema with `pg_dump`, imports it into the diagram, then applies the
layout in `erd/layout.json`: each table's position and colour, plus the group labels. Only
`erd/layout.json` is tracked; the diagram itself is regenerated each time.

Requirements, beyond the setup above:

- `pg_dump` and `dropdb` on your `PATH` (both come with PostgreSQL).
- The erd-editor MCP server, [`@dineug/erd-editor-mcp`](https://www.npmjs.com/package/@dineug/erd-editor-mcp).
  Set `ERD_MCP` to the path of its `erd-editor-mcp.js`, for example in `packages/server/.env`
  (the script loads that file). If `ERD_MCP` is unset, the script runs `npx -y @dineug/erd-editor-mcp`.
- To view and edit the diagram: the ERD Editor extension for VS Code (`dineug.vuerd-vscode`), or
  [erd-editor.io](https://erd-editor.io).

After a schema change:

1. Run `pnpm erd`. Tables that `erd/layout.json` doesn't know about are placed in a row below
   the diagram, and the script lists them.
2. Open `docs/twnr.erd.json` in the editor, drag the new tables into place, and save.
3. Run `pnpm erd:save-layout` to write the positions back to `erd/layout.json`, then commit it.

## Deployment

Refer to ./DEPLOY.md


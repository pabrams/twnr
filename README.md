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

### 2. Create databases and user

```bash
sudo -u postgres psql -c "CREATE USER twnr_user WITH PASSWORD 'twnr_pass';"
sudo -u postgres psql -c "CREATE DATABASE twnr OWNER twnr_user;"
sudo -u postgres psql -c "CREATE DATABASE twnr_test OWNER twnr_user;"
```

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

### 6. Start the server

```bash
cd packages/server
pnpm start
```

You should see:
```
PostgreSQL connected and schema verified
Server listening on port 3000
```

### 7. Start the client

Open a new terminal in the project root:

```bash
cd packages/client
pnpm run dev
```

Visit http://localhost:5173 and register.



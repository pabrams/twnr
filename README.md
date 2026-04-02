# README

This is a web-based remake of the classic Trade Wars 2002 bulletin board system door game. 

## SETUP THE SERVER

These steps should work on Arch-based Linux distros.

```
# install postgresql
sudo pacman -S postgresql

# initialize and configure to start on boot
sudo -u postgres initdb -D /var/lib/postgres/data
sudo systemctl enable --now postgresql

# create user and db
sudo -u postgres psql -c "CREATE USER twnr_user WITH PASSWORD 'twnr_pass';" 
sudo -u postgres psql -c "CREATE DATABASE twnr OWNER twnr_user;" 

# install and build
pnpm install
pnpm build

# test
pnpm test

# create universe and start twnr server ()
cd packages/server
pnpm run generate-env
pnpm run db:seed
pnpm start
```

You should see:
PostgreSQL connected and schema verified
Server listening on port 3000

## START CLIENT

Open a new terminal in project root, and then:

```
cd packages/client
pnpm run dev
```

Visit http://localhost:5173 and register



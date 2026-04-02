# README

This is a web-based remake of the classic Trade Wars 2002 bulletin board system door game. 

## SETUP THE SERVER

The following requires postgresql already be installed. 

```
pnpm install
pnpm build
systemctl start postgresql
sudo -u postgres psql -c "CREATE USER twnr_user WITH PASSWORD 'twnr_pass';" 
sudo -u postgres psql -c "CREATE DATABASE twnr OWNER twnr_user;" 
cd packages/server
pnpm run generate-env
pnpm run db:seed
sudo -u postgres psql -d twnr -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO twnr_user;"
sudo -u postgres psql -d twnr -c "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO twnr_user;"
pnpm start
```

You should see:
PostgreSQL connected and schema verified
Server listening on port 3000

## START CLIENT

```
cd packages/client
pnpm run dev
```

Visit http://localhost:5173 and register



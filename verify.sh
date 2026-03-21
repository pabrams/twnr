#!/bin/bash

# verify.sh — Starts PostgreSQL, builds the project, runs test suite.

set -o pipefail

echo "Starting PostgreSQL..."
service postgresql start
sleep 2

# Ensure the database and user exist (idempotent)
su postgres -c "psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='twnr_user'\" | grep -q 1 || psql -c \"CREATE USER twnr_user WITH PASSWORD 'twnr_pass';\"" 2>/dev/null
su postgres -c "psql -tc \"SELECT 1 FROM pg_database WHERE datname='twnr'\" | grep -q 1 || psql -c \"CREATE DATABASE twnr OWNER twnr_user;\"" 2>/dev/null
su postgres -c "psql -d twnr -c \"GRANT ALL ON SCHEMA public TO twnr_user;\"" 2>/dev/null

echo "Building TypeScript..."
npx tsc 2>&1 || echo "(tsc exited with errors — may be expected in pre-migration state)"

# Run the test suite
node test_migration.mjs
exit $?

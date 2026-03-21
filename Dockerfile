FROM --platform=linux/amd64 debian:bookworm-slim

# ── System packages ──────────────────────────────────────────────────
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    gnupg \
    git \
    postgresql \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

# PostgreSQL: create database and role
RUN service postgresql start \
    && su postgres -c "psql -c \"CREATE USER twnr_user WITH PASSWORD 'twnr_pass';\"" \
    && su postgres -c "psql -c \"CREATE DATABASE twnr OWNER twnr_user;\"" \
    && su postgres -c "psql -d twnr -c \"GRANT ALL ON SCHEMA public TO twnr_user;\"" \
    && service postgresql stop

WORKDIR /app

# Clone the repo
RUN git clone https://github.com/pabrams/twnr-server.git .

# Install project dependencies
RUN npm install

# sExtra packages needed for migration target and test suite
RUN npm install pg @types/pg typescript

# Copy any local override files
COPY . .

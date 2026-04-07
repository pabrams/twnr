import pg from 'pg';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { spawn } from 'node:child_process';

const { Pool } = pg;
export const JWT_SECRET = 'test-jwt-secret';
export const ADMIN_API_KEY = 'test-admin-key';
export const TEST_DB = 'twnr_test';
export const BASE = 'http://localhost:3000';

export function createPool() {
  return new Pool({
    host: process.env.PGHOST || 'localhost',
    database: TEST_DB,
    user: process.env.PGUSER || 'twnr_user',
    password: process.env.PGPASSWORD || 'twnr_pass',
  });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${derivedKey.toString('base64url')}`;
}

export async function createAdminUser(pool) {
  const email = `admin_${Date.now()}@test.com`;
  const hash = hashPassword('testpass');
  const res = await pool.query(
    `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'admin') RETURNING id, role, token_version`,
    [email, hash],
  );
  const user = res.rows[0];
  const token = jwt.sign(
    { userId: user.id, name: 'Admin', role: 'admin', tokenVersion: user.token_version },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '7d' },
  );
  return { userId: user.id, token };
}

export async function createRegularUser(pool) {
  const email = `player_${Date.now()}@test.com`;
  const hash = hashPassword('testpass');
  const res = await pool.query(
    `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'player') RETURNING id, role, token_version`,
    [email, hash],
  );
  const user = res.rows[0];
  const token = jwt.sign(
    { userId: user.id, name: 'Player', role: 'player', tokenVersion: user.token_version },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '7d' },
  );
  return { userId: user.id, token };
}

export function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['dist/server.js'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PGDATABASE: TEST_DB,
        PGUSER: process.env.PGUSER || 'twnr_user',
        PGPASSWORD: process.env.PGPASSWORD || 'twnr_pass',
        JWT_SECRET,
        ADMIN_API_KEY,
        WS_ALLOWED_ORIGINS: 'http://localhost:3000',
      },
    });

    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error('Server start timeout (15s)')); }
    }, 15000);

    let stdout = '';
    proc.stdout.on('data', (d) => {
      stdout += d.toString();
      if (!settled && (stdout.includes('listening') || stdout.includes('3000'))) {
        settled = true;
        clearTimeout(timeout);
        setTimeout(() => resolve(proc), 1000);
      }
    });

    proc.stderr.on('data', (d) => {
      const text = d.toString().trim();
      if (text) process.stderr.write(`[server] ${text}\n`);
    });

    proc.on('error', (err) => {
      if (!settled) { settled = true; clearTimeout(timeout); reject(err); }
    });
    proc.on('exit', (code) => {
      if (!settled) { settled = true; clearTimeout(timeout); reject(new Error(`Server exited ${code}`)); }
    });
  });
}

export async function adminPost(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Cookie'] = `twnr_auth=${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

export async function adminGet(path, token) {
  const headers = {};
  if (token) headers['Cookie'] = `twnr_auth=${token}`;
  const res = await fetch(`${BASE}${path}`, { headers });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

export async function adminPut(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Cookie'] = `twnr_auth=${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

export async function adminDelete(path, token) {
  const headers = {};
  if (token) headers['Cookie'] = `twnr_auth=${token}`;
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE', headers });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

export async function adminKeyPost(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': ADMIN_API_KEY },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

export async function adminKeyGet(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'X-Admin-Key': ADMIN_API_KEY },
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

export async function adminKeyDelete(path) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'DELETE',
    headers: { 'X-Admin-Key': ADMIN_API_KEY },
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

export async function adminKeyPut(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': ADMIN_API_KEY },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

// BFS connectivity check
export function isConnected(sectorCount, warps) {
  const adj = new Map();
  for (let i = 1; i <= sectorCount; i++) adj.set(i, []);
  for (const w of warps) {
    if (adj.has(w.sector_from)) adj.get(w.sector_from).push(w.sector_to);
  }
  const visited = new Set();
  const queue = [1];
  visited.add(1);
  while (queue.length > 0) {
    const node = queue.shift();
    for (const next of (adj.get(node) || [])) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return visited.size === sectorCount;
}

export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'player',
    token_version INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS universes (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    seed INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS sectors (
    id SERIAL PRIMARY KEY,
    universe_id INT NOT NULL REFERENCES universes(id) ON DELETE CASCADE,
    sector_number INT NOT NULL,
    name VARCHAR(255),
    UNIQUE(universe_id, sector_number)
  );
  CREATE TABLE IF NOT EXISTS warps (
    from_sector_id INT NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
    to_sector_id INT NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
    PRIMARY KEY(from_sector_id, to_sector_id)
  );
  CREATE TABLE IF NOT EXISTS players (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255),
    user_id INTEGER NOT NULL REFERENCES users(id),
    universe_id INTEGER NOT NULL REFERENCES universes(id),
    current_sector_id INTEGER,
    ship_destroyed_date TIMESTAMPTZ,
    docked BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (user_id, universe_id)
  );
  CREATE TABLE IF NOT EXISTS ports (
    id SERIAL PRIMARY KEY,
    sector_id INTEGER NOT NULL UNIQUE REFERENCES sectors(id) ON DELETE CASCADE,
    class INTEGER NOT NULL,
    fuel INTEGER NOT NULL DEFAULT 1000,
    fuel_price INTEGER NOT NULL,
    organics INTEGER NOT NULL DEFAULT 1000,
    org_price INTEGER NOT NULL,
    equipment INTEGER NOT NULL DEFAULT 1000,
    equ_price INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS planets (
    id SERIAL PRIMARY KEY,
    sector_id INTEGER NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(255) NOT NULL DEFAULT 'Terran',
    drones SMALLINT NOT NULL DEFAULT 0,
    fuel SMALLINT NOT NULL DEFAULT 0,
    organics SMALLINT NOT NULL DEFAULT 0,
    equipment SMALLINT NOT NULL DEFAULT 0,
    colonists_fuel SMALLINT NOT NULL DEFAULT 0,
    colonists_organics SMALLINT NOT NULL DEFAULT 0,
    colonists_equipment SMALLINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ
  );
  CREATE TABLE IF NOT EXISTS ship_cargo (
    player_id INTEGER PRIMARY KEY,
    fuel INTEGER NOT NULL DEFAULT 0,
    organics INTEGER NOT NULL DEFAULT 0,
    equipment INTEGER NOT NULL DEFAULT 0,
    colonists INTEGER NOT NULL DEFAULT 0,
    credits INTEGER NOT NULL DEFAULT 10000
  );
  CREATE TABLE IF NOT EXISTS visited_sectors (
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    sector_id INTEGER NOT NULL,
    PRIMARY KEY (player_id, sector_id)
  );
  CREATE TABLE IF NOT EXISTS player_ships (
    player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
    ship_name VARCHAR(255) NOT NULL,
    drones INTEGER NOT NULL DEFAULT 0,
    shields INTEGER NOT NULL DEFAULT 0,
    cargo_limit INTEGER NOT NULL
  );
`;

export async function setupAdminTests() {
  const pool = createPool();
  const client = await pool.connect();
  try {
    await client.query(SCHEMA_SQL);
  } finally {
    client.release();
  }
  const serverProc = await startServer();
  return { pool, serverProc };
}

export async function teardownAdminTests(pool, serverProc) {
  if (serverProc) {
    serverProc.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 1000));
  }
  if (pool) await pool.end();
}

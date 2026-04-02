import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn, execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const { Pool } = pg;
const SERVER_DIR = process.cwd();
const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
const BASE = 'http://localhost:3000';

// ─── Helpers ────────────────────────────────────────────────────────────────

function createPool() {
  return new Pool({
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'twnr',
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
  });
}

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['dist/server.js'], {
      cwd: SERVER_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        JWT_SECRET,
        ADMIN_API_KEY: process.env.ADMIN_API_KEY || 'test-admin-key',
        WS_ALLOWED_ORIGINS: process.env.WS_ALLOWED_ORIGINS || 'http://localhost:3000',
      },
    });

    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error('Server start timeout (15s)')); }
    }, 15000);

    proc.stdout.on('data', (d) => {
      const out = d.toString();
      if (!settled && (out.includes('listening') || out.includes('3000'))) {
        settled = true;
        clearTimeout(timeout);
        setTimeout(() => resolve(proc), 3000);
      }
    });

    proc.stderr.on('data', (d) => {
      const text = d.toString().trim();
      if (text) process.stderr.write(`[server stderr] ${text}\n`);
    });

    proc.on('error', (err) => {
      if (!settled) { settled = true; clearTimeout(timeout); reject(err); }
    });
    proc.on('exit', (code) => {
      if (!settled) { settled = true; clearTimeout(timeout); reject(new Error(`Server exited with code ${code}`)); }
    });
  });
}

async function connectWS(token, universeId) {
  const { default: WebSocket } = await import('ws');
  const headers = { Cookie: `twnr_auth=${token}` };
  const url = `ws://localhost:3000/ws?universe=${universeId}`;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('WS connect timeout')); }, 5000);

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'welcome') {
        clearTimeout(timer);
        resolve({ ws, welcome: msg });
      }
    });
    ws.on('error', (err) => { clearTimeout(timer); reject(err); });
    ws.on('close', (code) => {
      clearTimeout(timer);
      reject(new Error(`WS closed with code ${code}`));
    });
  });
}

function closeWS(ws) {
  return new Promise((resolve) => {
    if (!ws || ws.readyState > 1) { resolve(); return; }
    ws.on('close', resolve);
    ws.close();
    setTimeout(resolve, 5000);
  });
}

function wsRequest(ws, msg, responseType, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for "${responseType}"`)), timeout);
    function handler(data) {
      const parsed = JSON.parse(data.toString());
      if (parsed.type === responseType || parsed.type === 'error') {
        clearTimeout(timer);
        ws.removeListener('message', handler);
        resolve(parsed);
      }
    }
    ws.on('message', handler);
    ws.send(JSON.stringify(msg));
  });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${derivedKey.toString('base64url')}`;
}

/** Create a user directly in the DB, bypassing the rate-limited API. Returns { status, body: { userId }, token }. */
async function createTestUser(name, email, password) {
  const hash = hashPassword(password);
  const res = await pool.query(
    `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'player') RETURNING id, role, token_version`,
    [email, hash],
  );
  const user = res.rows[0];
  const token = jwt.sign(
    { userId: user.id, name, role: user.role, tokenVersion: user.token_version },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '7d' },
  );
  return { status: 201, body: { userId: user.id }, token };
}

async function registerUser(name, email, password) {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  });
  const body = await res.json();
  let token = null;
  const cookies = res.headers.getSetCookie?.() || [];
  for (const c of cookies) {
    const match = c.match(/twnr_auth=([^;]+)/);
    if (match) token = match[1];
  }
  return { status: res.status, body, token };
}

async function loginUser(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  let token = null;
  const cookies = res.headers.getSetCookie?.() || [];
  for (const c of cookies) {
    const match = c.match(/twnr_auth=([^;]+)/);
    if (match) token = match[1];
  }
  return { status: res.status, body, token };
}

async function createUniverse(token, name) {
  const res = await fetch(`${BASE}/api/universes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `twnr_auth=${token}`,
    },
    body: JSON.stringify({ name }),
  });
  return { status: res.status, body: await res.json() };
}

async function listUniverses(token) {
  const res = await fetch(`${BASE}/api/universes`, {
    headers: { Cookie: `twnr_auth=${token}` },
  });
  return { status: res.status, body: await res.json() };
}

async function joinUniverse(token, universeId, name = 'TestPlayer') {
  const res = await fetch(`${BASE}/api/universes/${universeId}/join`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `twnr_auth=${token}`,
    },
    body: JSON.stringify({ name }),
  });
  return { status: res.status, body: await res.json() };
}

/** Seed minimal sector/warp data for a universe directly in DB */
async function seedUniverseSectors(pool, universeId, numSectors = 5) {
  for (let i = 1; i <= numSectors; i++) {
    await pool.query(
      'INSERT INTO sectors (id, universe_id, name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [i, universeId, i === 1 ? 'Federation Space' : null],
    );
  }
  // Create warps: 1->2, 2->3, ..., (n-1)->n, n->1
  for (let i = 1; i <= numSectors; i++) {
    const next = i < numSectors ? i + 1 : 1;
    await pool.query(
      'INSERT INTO warps (sector_from, sector_to, universe_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [i, next, universeId],
    );
    await pool.query(
      'INSERT INTO warps (sector_from, sector_to, universe_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [next, i, universeId],
    );
  }
}

// ─── Setup ──────────────────────────────────────────────────────────────────

let pool;
let serverProc;

before(async () => {
  pool = createPool();
  await pool.query('SELECT 1');
  // Drop all tables to start fresh
  await pool.query(`
    DROP TABLE IF EXISTS ship_cargo CASCADE;
    DROP TABLE IF EXISTS player_ships CASCADE;
    DROP TABLE IF EXISTS ports CASCADE;
    DROP TABLE IF EXISTS warps CASCADE;
    DROP TABLE IF EXISTS players CASCADE;
    DROP TABLE IF EXISTS sectors CASCADE;
    DROP TABLE IF EXISTS universes CASCADE;
    DROP TABLE IF EXISTS users CASCADE;
  `);
  await pool.end();

  // Server should start with empty database (no sectors required)
  serverProc = await startServer();

  pool = createPool();
});

after(async () => {
  if (serverProc) serverProc.kill();
  if (pool) await pool.end();
});

// ─── 1. Users table ─────────────────────────────────────────────────────────

describe('Users table schema', () => {
  it('users table exists with required columns', async () => {
    const res = await pool.query(`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'users'
      ORDER BY ordinal_position
    `);
    const cols = res.rows.map(r => r.column_name);
    assert.ok(cols.includes('id'), 'users table should have id column');
    assert.ok(cols.includes('email'), 'users table should have email column');
    assert.ok(cols.includes('password_hash'), 'users table should have password_hash column');
    assert.ok(cols.includes('role'), 'users table should have role column');
    assert.ok(cols.includes('token_version'), 'users table should have token_version column');
  });

  it('users.email has a unique constraint', async () => {
    const res = await pool.query(`
      SELECT constraint_type FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
      WHERE tc.table_name = 'users' AND ccu.column_name = 'email' AND tc.constraint_type = 'UNIQUE'
    `);
    assert.ok(res.rows.length > 0, 'email column should have a unique constraint');
  });
});

// ─── 2. Universes table ─────────────────────────────────────────────────────

describe('Universes table schema', () => {
  it('universes table exists with required columns', async () => {
    const res = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'universes'
      ORDER BY ordinal_position
    `);
    const cols = res.rows.map(r => r.column_name);
    assert.ok(cols.includes('id'), 'universes table should have id column');
    assert.ok(cols.includes('name'), 'universes table should have name column');
    assert.ok(cols.includes('seed'), 'universes table should have seed column');
    assert.ok(cols.includes('created_at'), 'universes table should have created_at column');
  });
});

// ─── 3. Players table modifications ─────────────────────────────────────────

describe('Players table modifications', () => {
  it('players table has user_id column', async () => {
    const res = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'players' AND column_name = 'user_id'
    `);
    assert.equal(res.rows.length, 1, 'players table should have user_id column');
  });

  it('players table has universe_id column', async () => {
    const res = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'players' AND column_name = 'universe_id'
    `);
    assert.equal(res.rows.length, 1, 'players table should have universe_id column');
  });

  it('players table does not have email column', async () => {
    const res = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'players' AND column_name = 'email'
    `);
    assert.equal(res.rows.length, 0, 'players table should NOT have email column');
  });

  it('players table does not have password_hash column', async () => {
    const res = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'players' AND column_name = 'password_hash'
    `);
    assert.equal(res.rows.length, 0, 'players table should NOT have password_hash column');
  });

  it('players table does not have role column', async () => {
    const res = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'players' AND column_name = 'role'
    `);
    assert.equal(res.rows.length, 0, 'players table should NOT have role column');
  });

  it('players table does not have token_version column', async () => {
    const res = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'players' AND column_name = 'token_version'
    `);
    assert.equal(res.rows.length, 0, 'players table should NOT have token_version column');
  });

  it('players has unique constraint on (user_id, universe_id)', async () => {
    const res = await pool.query(`
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
      WHERE tc.table_name = 'players' AND tc.constraint_type = 'UNIQUE'
      GROUP BY tc.constraint_name
      HAVING array_agg(ccu.column_name::text ORDER BY ccu.column_name) @> ARRAY['universe_id', 'user_id']
    `);
    assert.ok(res.rows.length > 0, 'players should have unique constraint on (user_id, universe_id)');
  });
});

// ─── 4. Universe-scoped tables ──────────────────────────────────────────────

describe('Universe-scoped tables', () => {
  it('sectors table has universe_id column', async () => {
    const res = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'sectors' AND column_name = 'universe_id'
    `);
    assert.equal(res.rows.length, 1, 'sectors should have universe_id column');
  });

  it('warps table has universe_id column', async () => {
    const res = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'warps' AND column_name = 'universe_id'
    `);
    assert.equal(res.rows.length, 1, 'warps should have universe_id column');
  });

  it('ports table has universe_id column', async () => {
    const res = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'ports' AND column_name = 'universe_id'
    `);
    assert.equal(res.rows.length, 1, 'ports should have universe_id column');
  });

  it('sectors primary key includes universe_id', async () => {
    const res = await pool.query(`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_name = 'sectors' AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY kcu.ordinal_position
    `);
    const pkCols = res.rows.map(r => r.column_name);
    assert.ok(pkCols.includes('id'), 'sectors PK should include id');
    assert.ok(pkCols.includes('universe_id'), 'sectors PK should include universe_id');
  });

  it('warps primary key includes universe_id', async () => {
    const res = await pool.query(`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_name = 'warps' AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY kcu.ordinal_position
    `);
    const pkCols = res.rows.map(r => r.column_name);
    assert.ok(pkCols.includes('universe_id'), 'warps PK should include universe_id');
  });

  it('ports has unique constraint on (sector_id, universe_id)', async () => {
    const res = await pool.query(`
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
      WHERE tc.table_name = 'ports' AND tc.constraint_type = 'UNIQUE'
      GROUP BY tc.constraint_name
      HAVING array_agg(ccu.column_name::text ORDER BY ccu.column_name) @> ARRAY['sector_id', 'universe_id']
    `);
    assert.ok(res.rows.length > 0, 'ports should have unique constraint on (sector_id, universe_id)');
  });
});

// ─── 5. Registration and Login ──────────────────────────────────────────────

describe('Registration', () => {
  it('POST /api/auth/register creates a user (not a player) and returns userId', async () => {
    const ts = Date.now();
    const { status, body } = await registerUser(`reg_${ts}`, `reg_${ts}@test.com`, 'pass123');
    assert.equal(status, 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
    assert.ok(body.userId !== undefined, 'Response should contain userId');

    // Verify user exists in users table
    const userRes = await pool.query('SELECT id, email FROM users WHERE id = $1', [body.userId]);
    assert.equal(userRes.rows.length, 1, 'User should exist in users table');

    // Verify NO player row was created
    const playerRes = await pool.query('SELECT id FROM players WHERE user_id = $1', [body.userId]);
    assert.equal(playerRes.rows.length, 0, 'No player should be created on registration');
  });

  it('POST /api/auth/register returns 409 for duplicate email', async () => {
    const ts = Date.now();
    const email = `dup_${ts}@test.com`;
    await registerUser(`dup1_${ts}`, email, 'pass123');
    const { status } = await registerUser(`dup2_${ts}`, email, 'pass456');
    assert.equal(status, 409, 'Should return 409 for duplicate email');
  });
});

describe('Login', () => {
  it('POST /api/auth/login authenticates against users table and returns userId', async () => {
    const ts = Date.now();
    const email = `login_${ts}@test.com`;
    await createTestUser(`login_${ts}`, email, 'pass123');

    const { status, body } = await loginUser(email, 'pass123');
    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert.ok(body.userId !== undefined, 'Response should contain userId');
  });

  it('login JWT payload contains userId, role, and tokenVersion', async () => {
    const ts = Date.now();
    const email = `jwtlogin_${ts}@test.com`;
    await createTestUser(`jwtlogin_${ts}`, email, 'pass123');

    const login = await loginUser(email, 'pass123');
    assert.ok(login.token, 'Should receive a JWT token on login');

    const decoded = jwt.verify(login.token, JWT_SECRET);
    assert.ok(decoded.userId !== undefined, 'Login JWT should contain userId');
    assert.ok(decoded.role !== undefined, 'Login JWT should contain role');
    assert.ok(decoded.tokenVersion !== undefined, 'Login JWT should contain tokenVersion');
  });

  it('POST /api/auth/login returns 401 for wrong password', async () => {
    const ts = Date.now();
    const email = `wrongpw_${ts}@test.com`;
    await createTestUser(`wrongpw_${ts}`, email, 'correctpass');

    const { status } = await loginUser(email, 'wrongpass');
    assert.equal(status, 401, 'Should return 401 for wrong password');
  });

  it('JWT payload contains userId instead of playerId', async () => {
    const ts = Date.now();
    const email = `jwt_${ts}@test.com`;
    const reg = await registerUser(`jwt_${ts}`, email, 'pass123');
    const token = reg.token;
    assert.ok(token, 'Should receive a JWT token');

    const decoded = jwt.verify(token, JWT_SECRET);
    assert.ok(decoded.userId !== undefined, 'JWT should contain userId');
    assert.equal(decoded.userId, reg.body.userId, 'JWT userId should match response userId');
  });
});

// ─── 6. Universe Management API ─────────────────────────────────────────────

describe('Universe Management', () => {
  it('POST /api/universes creates a universe and returns universeId', async () => {
    const ts = Date.now();
    const reg = await createTestUser(`univ_${ts}`, `univ_${ts}@test.com`, 'pass123');
    const { status, body } = await createUniverse(reg.token, `Test Universe ${ts}`);
    assert.equal(status, 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
    assert.ok(body.universeId !== undefined, 'Should return universeId');
    assert.ok(body.name, 'Should return name');
  });

  it('POST /api/universes returns 400 for missing name', async () => {
    const ts = Date.now();
    const reg = await createTestUser(`noname_${ts}`, `noname_${ts}@test.com`, 'pass123');
    const { status } = await createUniverse(reg.token, '');
    assert.equal(status, 400, 'Should return 400 for empty name');
  });

  it('POST /api/universes returns 401 without auth', async () => {
    const res = await fetch(`${BASE}/api/universes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'No Auth Universe' }),
    });
    assert.ok([401, 403].includes(res.status), `Should return 401 or 403 without auth, got ${res.status}`);
  });

  it('GET /api/universes lists created universes', async () => {
    const ts = Date.now();
    const reg = await createTestUser(`list_${ts}`, `list_${ts}@test.com`, 'pass123');
    await createUniverse(reg.token, `ListTest ${ts}`);
    const { status, body } = await listUniverses(reg.token);
    assert.equal(status, 200);
    assert.ok(Array.isArray(body), 'Should return an array');
    assert.ok(body.length > 0, 'Should have at least one universe');
    const found = body.find(u => u.name === `ListTest ${ts}`);
    assert.ok(found, 'Created universe should be in the list');
    assert.ok(found.id !== undefined, 'Universe should have id');
    assert.ok(found.createdAt !== undefined || found.created_at !== undefined, 'Universe should have createdAt');
  });
});

// ─── Join Universe ──────────────────────────────────────────────────────────

describe('Join Universe', () => {
  it('POST /api/universes/:id/join creates a player in the universe', async () => {
    const ts = Date.now();
    const reg = await createTestUser(`join_${ts}`, `join_${ts}@test.com`, 'pass123');
    const univ = await createUniverse(reg.token, `JoinTest ${ts}`);
    // Seed sectors so the player can be placed in sector 1
    await seedUniverseSectors(pool, univ.body.universeId);

    const { status, body } = await joinUniverse(reg.token, univ.body.universeId, 'CaptainJoin');
    assert.equal(status, 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
    assert.ok(body.playerId !== undefined, 'Should return playerId');
    assert.ok(body.universeId !== undefined, 'Should return universeId');

    // Verify player row
    const playerRes = await pool.query(
      'SELECT user_id, universe_id, current_sector, name FROM players WHERE id = $1',
      [body.playerId],
    );
    assert.equal(playerRes.rows.length, 1);
    assert.equal(playerRes.rows[0].user_id, reg.body.userId);
    assert.equal(playerRes.rows[0].universe_id, univ.body.universeId);
    assert.equal(playerRes.rows[0].current_sector, 1);
    assert.equal(playerRes.rows[0].name, 'CaptainJoin');

    // Verify ship
    const shipRes = await pool.query(
      'SELECT ship_name, fighters, shields, cargo_limit FROM player_ships WHERE player_id = $1',
      [body.playerId],
    );
    assert.equal(shipRes.rows.length, 1);
    assert.equal(shipRes.rows[0].ship_name, 'Merchant Freighter');
    assert.equal(shipRes.rows[0].fighters, 0);
    assert.equal(shipRes.rows[0].shields, 0);

    // Verify cargo_limit matches merchant.json startingHolds (5)
    assert.equal(shipRes.rows[0].cargo_limit, 5, 'cargo_limit should match merchant.json startingHolds');

    // Verify cargo
    const cargoRes = await pool.query(
      'SELECT credits, fuel, organics, equipment FROM ship_cargo WHERE player_id = $1',
      [body.playerId],
    );
    assert.equal(cargoRes.rows.length, 1);
    assert.equal(cargoRes.rows[0].credits, 10000);
    assert.equal(cargoRes.rows[0].fuel, 0, 'fuel should be 0 on join');
    assert.equal(cargoRes.rows[0].organics, 0, 'organics should be 0 on join');
    assert.equal(cargoRes.rows[0].equipment, 0, 'equipment should be 0 on join');
  });

  it('POST /api/universes/:id/join returns 409 if already joined', async () => {
    const ts = Date.now();
    const reg = await createTestUser(`rejoin_${ts}`, `rejoin_${ts}@test.com`, 'pass123');
    const univ = await createUniverse(reg.token, `RejoinTest ${ts}`);
    await seedUniverseSectors(pool, univ.body.universeId);
    await joinUniverse(reg.token, univ.body.universeId);
    const { status } = await joinUniverse(reg.token, univ.body.universeId);
    assert.equal(status, 409, 'Should return 409 for duplicate join');
  });

  it('POST /api/universes/:id/join returns 404 for nonexistent universe', async () => {
    const ts = Date.now();
    const reg = await createTestUser(`nouniv_${ts}`, `nouniv_${ts}@test.com`, 'pass123');
    const { status } = await joinUniverse(reg.token, 999999);
    assert.equal(status, 404, 'Should return 404 for nonexistent universe');
  });

  it('POST /api/universes/:id/join returns 400 for missing name', async () => {
    const ts = Date.now();
    const reg = await createTestUser(`noname_join_${ts}`, `noname_join_${ts}@test.com`, 'pass123');
    const univ = await createUniverse(reg.token, `NoNameJoin ${ts}`);
    const res = await fetch(`${BASE}/api/universes/${univ.body.universeId}/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `twnr_auth=${reg.token}`,
      },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400, 'Should return 400 for missing name');
  });

  it('stores the provided player name', async () => {
    const ts = Date.now();
    const reg = await createTestUser(`named_${ts}`, `named_${ts}@test.com`, 'pass123');
    const univ = await createUniverse(reg.token, `NameTest ${ts}`);
    await seedUniverseSectors(pool, univ.body.universeId);
    const join = await joinUniverse(reg.token, univ.body.universeId, 'SpaceCaptain');
    assert.equal(join.status, 201);

    const playerRes = await pool.query('SELECT name FROM players WHERE id = $1', [join.body.playerId]);
    assert.equal(playerRes.rows[0].name, 'SpaceCaptain');
  });

  it('a user can join multiple different universes', async () => {
    const ts = Date.now();
    const reg = await createTestUser(`multi_${ts}`, `multi_${ts}@test.com`, 'pass123');
    const univ1 = await createUniverse(reg.token, `Multi1 ${ts}`);
    const univ2 = await createUniverse(reg.token, `Multi2 ${ts}`);
    await seedUniverseSectors(pool, univ1.body.universeId);
    await seedUniverseSectors(pool, univ2.body.universeId);
    const join1 = await joinUniverse(reg.token, univ1.body.universeId, 'Player1');
    const join2 = await joinUniverse(reg.token, univ2.body.universeId, 'Player2');
    assert.equal(join1.status, 201);
    assert.equal(join2.status, 201);
    assert.notEqual(join1.body.playerId, join2.body.playerId);
  });
});

// ─── 6b. GET /api/universes auth ────────────────────────────────────────────

describe('List Universes auth', () => {
  it('GET /api/universes returns 401 or 403 without auth', async () => {
    const res = await fetch(`${BASE}/api/universes`);
    assert.ok([401, 403].includes(res.status), `Should return 401 or 403 without auth, got ${res.status}`);
  });
});

// ─── 9. importUniverse.js --universe-id flag ────────────────────────────────

describe('importUniverse.js --universe-id flag', () => {
  it('imports sectors with the specified universe_id', async () => {
    // Create a temporary bigbang output directory with minimal CSV data
    const tmpDir = mkdtempSync(join(tmpdir(), 'twnr-import-test-'));

    writeFileSync(join(tmpDir, 'sectors.csv'), 'id,name\n1,Federation Space\n2,Sector 2\n');
    writeFileSync(join(tmpDir, 'warps.csv'), 'from,to\n1,2\n2,1\n');
    writeFileSync(join(tmpDir, 'ports.csv'), 'sector,class,fuel,fuel_price,organics,org_price,equipment,equ_price\n2,1,500,10,500,10,500,10\n');

    // Create a universe to import into
    const ts = Date.now();
    const reg = await createTestUser(`import_${ts}`, `import_${ts}@test.com`, 'pass123');
    const univ = await createUniverse(reg.token, `ImportTest ${ts}`);
    const uid = univ.body.universeId;

    // Run importUniverse.js with --universe-id
    const env = {
      ...process.env,
      PGHOST: process.env.PGHOST || 'localhost',
      PGDATABASE: process.env.PGDATABASE || 'twnr',
      PGUSER: process.env.PGUSER,
      PGPASSWORD: process.env.PGPASSWORD,
    };

    const result = execSync(
      `node ${SERVER_DIR}/scripts/importUniverse.js ${tmpDir} --force --universe-id ${uid}`,
      { env, timeout: 15000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );

    // Verify sectors were imported with the correct universe_id
    const sectorRes = await pool.query(
      'SELECT id, universe_id FROM sectors WHERE universe_id = $1 ORDER BY id',
      [uid],
    );
    assert.ok(sectorRes.rows.length >= 2, `Should have imported at least 2 sectors for universe ${uid}`);
    for (const row of sectorRes.rows) {
      assert.equal(row.universe_id, uid, `Sector should have universe_id = ${uid}`);
    }

    // Verify warps were imported with the correct universe_id
    const warpRes = await pool.query(
      'SELECT universe_id FROM warps WHERE universe_id = $1',
      [uid],
    );
    assert.ok(warpRes.rows.length >= 2, 'Should have imported warps');

    // Verify ports were imported with the correct universe_id
    const portRes = await pool.query(
      'SELECT universe_id FROM ports WHERE universe_id = $1',
      [uid],
    );
    assert.ok(portRes.rows.length >= 1, 'Should have imported ports');
  });

  it('defaults to universe_id=1 when --universe-id is not provided', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'twnr-import-default-'));
    writeFileSync(join(tmpDir, 'sectors.csv'), 'id,name\n1,Federation Space\n2,Sector 2\n');
    writeFileSync(join(tmpDir, 'warps.csv'), 'from,to\n1,2\n2,1\n');
    writeFileSync(join(tmpDir, 'ports.csv'), 'sector,class,fuel,fuel_price,organics,org_price,equipment,equ_price\n2,1,500,10,500,10,500,10\n');

    const env = {
      ...process.env,
      PGHOST: process.env.PGHOST || 'localhost',
      PGDATABASE: process.env.PGDATABASE || 'twnr',
      PGUSER: process.env.PGUSER,
      PGPASSWORD: process.env.PGPASSWORD,
    };

    // Ensure universe_id=1 exists
    await pool.query(
      'INSERT INTO universes (id, name) VALUES (1, $1) ON CONFLICT (id) DO NOTHING',
      ['Default Universe'],
    );

    execSync(
      `node ${SERVER_DIR}/scripts/importUniverse.js ${tmpDir} --force`,
      { env, timeout: 15000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );

    const sectorRes = await pool.query(
      'SELECT id, universe_id FROM sectors WHERE universe_id = 1 ORDER BY id',
    );
    assert.ok(sectorRes.rows.length >= 2, 'Should have imported sectors with default universe_id=1');
    for (const row of sectorRes.rows) {
      assert.equal(row.universe_id, 1, 'Sector should have universe_id = 1 by default');
    }
  });
});

// ─── 7. WebSocket scoping ───────────────────────────────────────────────────

describe('WebSocket universe scoping', () => {
  it('connects successfully when user has a player in the specified universe', async () => {
    const ts = Date.now();
    const reg = await createTestUser(`wsok_${ts}`, `wsok_${ts}@test.com`, 'pass123');
    const univ = await createUniverse(reg.token, `WSTest ${ts}`);
    await seedUniverseSectors(pool, univ.body.universeId);
    await joinUniverse(reg.token, univ.body.universeId, 'WSPlayer');

    const { ws, welcome } = await connectWS(reg.token, univ.body.universeId);
    assert.ok(welcome, 'Should receive welcome message');
    assert.equal(welcome.type, 'welcome');
    await closeWS(ws);
  });

  it('rejects WebSocket when no universe parameter is provided', async () => {
    const ts = Date.now();
    const reg = await createTestUser(`wsnouniv_${ts}`, `wsnouniv_${ts}@test.com`, 'pass123');
    const { default: WebSocket } = await import('ws');

    const ws = new WebSocket('ws://localhost:3000/ws', {
      headers: { Cookie: `twnr_auth=${reg.token}` },
    });

    const result = await new Promise((resolve) => {
      ws.on('open', () => {
        // If it opens but then closes, that's also a rejection
        setTimeout(() => { ws.terminate(); resolve('stayed_open'); }, 2000);
      });
      ws.on('close', (code) => resolve(`closed_${code}`));
      ws.on('error', () => resolve('error'));
      setTimeout(() => { ws.terminate(); resolve('timeout'); }, 3000);
    });

    assert.notEqual(result, 'stayed_open', 'WebSocket should be rejected without universe parameter');
  });

  it('rejects WebSocket when user has no player in specified universe', async () => {
    const ts = Date.now();
    const reg = await createTestUser(`wsnojoin_${ts}`, `wsnojoin_${ts}@test.com`, 'pass123');
    const univ = await createUniverse(reg.token, `NoJoin ${ts}`);
    // Don't join the universe
    const { default: WebSocket } = await import('ws');

    const ws = new WebSocket(`ws://localhost:3000/ws?universe=${univ.body.universeId}`, {
      headers: { Cookie: `twnr_auth=${reg.token}` },
    });

    const result = await new Promise((resolve) => {
      ws.on('open', () => {
        setTimeout(() => { ws.terminate(); resolve('stayed_open'); }, 2000);
      });
      ws.on('close', (code) => resolve(`closed_${code}`));
      ws.on('error', () => resolve('error'));
      setTimeout(() => { ws.terminate(); resolve('timeout'); }, 3000);
    });

    assert.notEqual(result, 'stayed_open', 'WebSocket should be rejected when user has no player in universe');
  });

  it('sector display only shows data from the connected universe', async () => {
    const ts = Date.now();
    const reg = await createTestUser(`scope_${ts}`, `scope_${ts}@test.com`, 'pass123');

    // Create two universes with different sector data
    const univA = await createUniverse(reg.token, `ScopeA ${ts}`);
    const univB = await createUniverse(reg.token, `ScopeB ${ts}`);

    // Universe A: sectors 1-5
    await seedUniverseSectors(pool, univA.body.universeId, 5);
    // Universe B: sectors 1-3 (fewer sectors, different warps)
    await seedUniverseSectors(pool, univB.body.universeId, 3);

    await joinUniverse(reg.token, univA.body.universeId, 'PlayerA');
    await joinUniverse(reg.token, univB.body.universeId, 'PlayerB');

    // Connect to universe A and check warps
    const { ws: wsA } = await connectWS(reg.token, univA.body.universeId);
    const dispA = await wsRequest(wsA, { type: 'sectorDisplay' }, 'sectorDisplay');
    assert.equal(dispA.type, 'sectorDisplay');
    assert.equal(dispA.sector, 1, 'Should be in sector 1');
    // Universe A has sector 2 as a warp from sector 1
    assert.ok(dispA.warps.includes(2), 'Universe A sector 1 should have warp to sector 2');
    await closeWS(wsA);

    // Connect to universe B and verify it sees universe B's warps, not A's
    const { ws: wsB } = await connectWS(reg.token, univB.body.universeId);
    const dispB = await wsRequest(wsB, { type: 'sectorDisplay' }, 'sectorDisplay');
    assert.equal(dispB.type, 'sectorDisplay');
    assert.equal(dispB.sector, 1);
    // Universe B has sectors 1-3, so sector 1 should NOT have warp to sector 4 or 5
    for (const w of dispB.warps) {
      assert.ok(w >= 1 && w <= 3, `Universe B sector 1 warp ${w} should be within sectors 1-3`);
    }
    await closeWS(wsB);
  });

  it('player broadcasts are isolated to the same universe and sector', async () => {
    const ts = Date.now();

    // Create two users
    const user1 = await createTestUser(`bcast1_${ts}`, `bcast1_${ts}@test.com`, 'pass123');
    const user2 = await createTestUser(`bcast2_${ts}`, `bcast2_${ts}@test.com`, 'pass123');
    const user3 = await createTestUser(`bcast3_${ts}`, `bcast3_${ts}@test.com`, 'pass123');

    // Create two universes
    const univA = await createUniverse(user1.token, `BcastA ${ts}`);
    const univB = await createUniverse(user1.token, `BcastB ${ts}`);
    await seedUniverseSectors(pool, univA.body.universeId, 5);
    await seedUniverseSectors(pool, univB.body.universeId, 5);

    // user1 and user2 join universe A; user3 joins universe B
    await joinUniverse(user1.token, univA.body.universeId, 'Player1A');
    await joinUniverse(user2.token, univA.body.universeId, 'Player2A');
    await joinUniverse(user3.token, univB.body.universeId, 'Player3B');

    // All start in sector 1. Connect all three.
    const { ws: ws1 } = await connectWS(user1.token, univA.body.universeId);
    const { ws: ws2 } = await connectWS(user2.token, univA.body.universeId);
    const { ws: ws3 } = await connectWS(user3.token, univB.body.universeId);

    // Collect messages on ws2 (same universe as ws1) and ws3 (different universe)
    const ws2Messages = [];
    const ws3Messages = [];
    ws2.on('message', (data) => ws2Messages.push(JSON.parse(data.toString())));
    ws3.on('message', (data) => ws3Messages.push(JSON.parse(data.toString())));

    // user1 moves from sector 1 to sector 2 in universe A
    await wsRequest(ws1, { type: 'move', sector: 2 }, 'sectorDisplay');

    // Give time for broadcasts to propagate
    await new Promise((resolve) => setTimeout(resolve, 500));

    // ws2 (same universe, was in same sector) should have received a broadcast
    const ws2Relevant = ws2Messages.filter(m => m.type === 'playerLeft' || m.type === 'playerMoved');
    assert.ok(ws2Relevant.length > 0, 'Player in same universe+sector should receive movement broadcast');

    // ws3 (different universe) should NOT have received any movement broadcast
    const ws3Relevant = ws3Messages.filter(m => m.type === 'playerLeft' || m.type === 'playerMoved');
    assert.equal(ws3Relevant.length, 0, 'Player in different universe should NOT receive movement broadcast');

    await closeWS(ws1);
    await closeWS(ws2);
    await closeWS(ws3);
  });
});

// ─── Login after ship destruction ───────────────────────────────────────────

describe('Login after ship destruction', () => {
  it('allows login when ship_destroyed_date is set and delay has passed (default=0)', async () => {
    const ts = Date.now();
    const email = `dest_${ts}@test.com`;
    const reg = await createTestUser(`dest_${ts}`, email, 'pass123');
    const univ = await createUniverse(reg.token, `DestTest ${ts}`);
    await seedUniverseSectors(pool, univ.body.universeId);
    const join = await joinUniverse(reg.token, univ.body.universeId, 'Destroyed');

    // Simulate destruction
    await pool.query('UPDATE players SET ship_destroyed_date = NOW() WHERE id = $1', [join.body.playerId]);
    await pool.query('DELETE FROM player_ships WHERE player_id = $1', [join.body.playerId]);
    await pool.query('DELETE FROM ship_cargo WHERE player_id = $1', [join.body.playerId]);

    const login = await loginUser(email, 'pass123');
    assert.equal(login.status, 200);

    const playerRes = await pool.query('SELECT ship_destroyed_date FROM players WHERE id = $1', [join.body.playerId]);
    assert.equal(playerRes.rows[0].ship_destroyed_date, null, 'ship_destroyed_date should be cleared');

    const shipRes = await pool.query('SELECT ship_name FROM player_ships WHERE player_id = $1', [join.body.playerId]);
    assert.equal(shipRes.rows.length, 1, 'New ship should be created');
    assert.equal(shipRes.rows[0].ship_name, 'Merchant Freighter');

    const cargoRes = await pool.query('SELECT credits FROM ship_cargo WHERE player_id = $1', [join.body.playerId]);
    assert.equal(cargoRes.rows.length, 1);
    assert.equal(cargoRes.rows[0].credits, 10000);
  });

  it('returns 403 when delay has not passed', async () => {
    const ts = Date.now();
    const email = `nodelay_${ts}@test.com`;
    const reg = await createTestUser(`nodelay_${ts}`, email, 'pass123');
    const univ = await createUniverse(reg.token, `NoDelay ${ts}`);
    await seedUniverseSectors(pool, univ.body.universeId);
    const join = await joinUniverse(reg.token, univ.body.universeId, 'Blocked');

    await pool.query(
      `UPDATE players SET ship_destroyed_date = NOW() + INTERVAL '1 hour' WHERE id = $1`,
      [join.body.playerId],
    );

    const login = await loginUser(email, 'pass123');
    assert.equal(login.status, 403);
    assert.ok(
      login.body.error && login.body.error.toLowerCase().includes('destroyed'),
      `Error should mention "destroyed", got: ${login.body.error}`,
    );
  });
});

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
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
    database: process.env.PGDATABASE || 'twnr_test',
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
        PGDATABASE: process.env.PGDATABASE || 'twnr_test',
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

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${derivedKey.toString('base64url')}`;
}

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
  await pool.query(`
    DROP TABLE IF EXISTS ship_cargo CASCADE;
    DROP TABLE IF EXISTS planets CASCADE;
    DROP TABLE IF EXISTS visited_sectors CASCADE;
    DROP TABLE IF EXISTS player_ships CASCADE;
    DROP TABLE IF EXISTS ports CASCADE;
    DROP TABLE IF EXISTS warps CASCADE;
    DROP TABLE IF EXISTS players CASCADE;
    DROP TABLE IF EXISTS sectors CASCADE;
    DROP TABLE IF EXISTS universes CASCADE;
    DROP TABLE IF EXISTS users CASCADE;
  `);
  await pool.end();

  serverProc = await startServer();

  pool = createPool();
});

after(async () => {
  if (serverProc) serverProc.kill();
  if (pool) await pool.end();
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

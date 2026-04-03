import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { spawn } from 'node:child_process';

const { Pool } = pg;
const JWT_SECRET = 'test-jwt-secret';
const ADMIN_API_KEY = 'test-admin-key';
const TEST_DB = 'twnr_test';
const BASE = 'http://localhost:3000';

let pool;
let serverProc;

function createPool() {
  return new Pool({
    host: process.env.PGHOST || 'localhost',
    database: TEST_DB,
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
  });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${derivedKey.toString('base64url')}`;
}

async function createAdminUser(pool) {
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

async function createRegularUser(pool) {
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

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['dist/server.js'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PGDATABASE: TEST_DB,
        PGUSER: process.env.PGUSER || 'postgres',
        PGPASSWORD: process.env.PGPASSWORD || 'postgres',
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

async function adminPost(path, body, token) {
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

async function adminGet(path, token) {
  const headers = {};
  if (token) headers['Cookie'] = `twnr_auth=${token}`;
  const res = await fetch(`${BASE}${path}`, { headers });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

async function adminPut(path, body, token) {
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

async function adminDelete(path, token) {
  const headers = {};
  if (token) headers['Cookie'] = `twnr_auth=${token}`;
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE', headers });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

async function adminKeyPost(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': ADMIN_API_KEY },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

async function adminKeyGet(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'X-Admin-Key': ADMIN_API_KEY },
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

async function adminKeyDelete(path) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'DELETE',
    headers: { 'X-Admin-Key': ADMIN_API_KEY },
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

async function adminKeyPut(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': ADMIN_API_KEY },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

// BFS connectivity check
function isConnected(sectorCount, warps) {
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

describe('Admin API - Authentication', () => {
  it('POST /api/admin/universes/generate rejects unauthenticated requests', async () => {
    const res = await adminPost('/api/admin/universes/generate', { name: 'Test', sectors: 20 }, null);
    assert.equal(res.status, 403);
  });

  it('POST /api/admin/universes/generate rejects non-admin users', async () => {
    const { token } = await createRegularUser(pool);
    const res = await adminPost('/api/admin/universes/generate', { name: 'Test', sectors: 20 }, token);
    assert.equal(res.status, 403);
  });

  it('GET /api/admin/universes/:id/stats rejects unauthenticated requests', async () => {
    const res = await adminGet('/api/admin/universes/999/stats', null);
    assert.equal(res.status, 403);
  });

  it('DELETE /api/admin/universes/:id rejects unauthenticated requests', async () => {
    const res = await adminDelete('/api/admin/universes/999', null);
    assert.equal(res.status, 403);
  });

  it('PUT /api/admin/universes/:id rejects unauthenticated requests', async () => {
    const res = await adminPut('/api/admin/universes/999', { name: 'New' }, null);
    assert.equal(res.status, 403);
  });

  it('POST /api/admin/universes/:id/clone rejects unauthenticated requests', async () => {
    const res = await adminPost('/api/admin/universes/999/clone', { name: 'Clone' }, null);
    assert.equal(res.status, 403);
  });

  it('GET /api/admin/universes/:id/topology rejects unauthenticated requests', async () => {
    const res = await adminGet('/api/admin/universes/999/topology', null);
    assert.equal(res.status, 403);
  });

  it('GET /api/admin/universes/:id/ports rejects unauthenticated requests', async () => {
    const res = await adminGet('/api/admin/universes/999/ports', null);
    assert.equal(res.status, 403);
  });

  it('PUT /api/admin/universes/:id/ports/:sectorId rejects unauthenticated requests', async () => {
    const res = await adminPut('/api/admin/universes/999/ports/1', { fuel: 100 }, null);
    assert.equal(res.status, 403);
  });

  it('POST /api/admin/universes/:id/ports/:sectorId rejects unauthenticated requests', async () => {
    const res = await adminPost('/api/admin/universes/999/ports/1', { class: 1 }, null);
    assert.equal(res.status, 403);
  });

  it('DELETE /api/admin/universes/:id/ports/:sectorId rejects unauthenticated requests', async () => {
    const res = await adminDelete('/api/admin/universes/999/ports/1', null);
    assert.equal(res.status, 403);
  });
});

describe('Admin API - Generate Universe', () => {
  it('creates a universe with valid parameters', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'TestUniverse',
      sectors: 30,
      seed: 12345,
    });
    assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.name, 'TestUniverse');
    assert.equal(res.body.seed, 12345);
    assert.equal(res.body.sectorCount, 30);
    assert.ok(res.body.id > 0, 'Should return a universe id');
    assert.ok(res.body.warpCount > 0, 'Should have warps');
    assert.ok(res.body.portCount > 0, 'Should have ports');
  });

  it('uses default portDensity and twoWayPct when omitted', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'DefaultsTest', sectors: 40, seed: 77777,
    });
    assert.equal(res.status, 201);
    const uid = res.body.id;

    // Default portDensity=50: expect ~50% of sectors to have trading ports
    const portRes = await pool.query(
      'SELECT COUNT(*) as cnt FROM ports WHERE universe_id = $1 AND class BETWEEN 1 AND 8', [uid]
    );
    const tradingPorts = parseInt(portRes.rows[0].cnt, 10);
    assert.ok(tradingPorts >= 15 && tradingPorts <= 25,
      `Expected ~19 trading ports with default 50% density on 40 sectors, got ${tradingPorts}`);

    // Default twoWayPct=90: expect ~90% bidirectional warps
    const warpRes = await pool.query(
      'SELECT sector_from, sector_to FROM warps WHERE universe_id = $1', [uid]
    );
    const warpSet = new Set(warpRes.rows.map(w => `${w.sector_from},${w.sector_to}`));
    let biCount = 0;
    const counted = new Set();
    for (const w of warpRes.rows) {
      const key = `${Math.min(w.sector_from, w.sector_to)},${Math.max(w.sector_from, w.sector_to)}`;
      if (!counted.has(key) && warpSet.has(`${w.sector_to},${w.sector_from}`)) {
        biCount++;
        counted.add(key);
      }
    }
    const biPct = (biCount * 2 / warpRes.rows.length) * 100;
    assert.ok(biPct >= 75 && biPct <= 100,
      `Expected ~90% bidirectional warps with default, got ${biPct.toFixed(1)}%`);
  });

  it('returns 400 when name is missing', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', { sectors: 30 });
    assert.equal(res.status, 400);
    assert.ok(res.body.error, 'Should have error message');
  });

  it('returns 400 when name is empty string', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', { name: '', sectors: 30 });
    assert.equal(res.status, 400);
  });

  it('returns 400 when sectors is below 20', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', { name: 'Small', sectors: 5 });
    assert.equal(res.status, 400);
  });

  it('returns 400 when sectors is above 500', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', { name: 'Huge', sectors: 1000 });
    assert.equal(res.status, 400);
  });

  it('returns 400 when sectors is missing', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', { name: 'NoSectors' });
    assert.equal(res.status, 400);
  });

  it('generates a random seed when not provided', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', { name: 'NoSeed', sectors: 20 });
    assert.equal(res.status, 201);
    assert.ok(typeof res.body.seed === 'number', 'Should return a numeric seed');
  });

  it('produces deterministic output with the same seed', async () => {
    const params = { name: 'Deterministic', sectors: 25, seed: 99999, portDensity: 50, twoWayPct: 90 };
    const res1 = await adminKeyPost('/api/admin/universes/generate', params);
    const res2 = await adminKeyPost('/api/admin/universes/generate', { ...params, name: 'Deterministic2' });
    assert.equal(res1.status, 201);
    assert.equal(res2.status, 201);
    assert.equal(res1.body.sectorCount, res2.body.sectorCount);
    assert.equal(res1.body.warpCount, res2.body.warpCount);
    assert.equal(res1.body.portCount, res2.body.portCount);

    // Verify actual data matches
    const stats1 = await adminKeyGet(`/api/admin/universes/${res1.body.id}/stats`);
    const stats2 = await adminKeyGet(`/api/admin/universes/${res2.body.id}/stats`);
    assert.equal(stats1.body.warpCount, stats2.body.warpCount);
    assert.equal(stats1.body.portCount, stats2.body.portCount);
  });

  it('creates Federation Space at sector 1 with Class 0 port', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', { name: 'FedTest', sectors: 20, seed: 42 });
    assert.equal(res.status, 201);
    const uid = res.body.id;

    // Check sector 1 is Federation Space
    const sectorRes = await pool.query(
      'SELECT name FROM sectors WHERE id = 1 AND universe_id = $1', [uid]
    );
    assert.equal(sectorRes.rows.length, 1);
    assert.equal(sectorRes.rows[0].name, 'Federation Space');

    // Check Class 0 port at sector 1
    const portRes = await pool.query(
      'SELECT class, fuel, fuel_price, organics, org_price, equipment, equ_price FROM ports WHERE sector_id = 1 AND universe_id = $1', [uid]
    );
    assert.equal(portRes.rows.length, 1);
    assert.equal(portRes.rows[0].class, 0);
    assert.equal(portRes.rows[0].fuel, 0);
    assert.equal(portRes.rows[0].fuel_price, 0);
    assert.equal(portRes.rows[0].organics, 0);
    assert.equal(portRes.rows[0].org_price, 0);
    assert.equal(portRes.rows[0].equipment, 0);
    assert.equal(portRes.rows[0].equ_price, 0);
  });

  it('creates a Stardock sector with Class 9 port', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', { name: 'StardockTest', sectors: 20, seed: 42 });
    assert.equal(res.status, 201);
    const uid = res.body.id;

    // Check Stardock exists
    const sectorRes = await pool.query(
      'SELECT id FROM sectors WHERE name = $1 AND universe_id = $2', ['Stardock', uid]
    );
    assert.equal(sectorRes.rows.length, 1, 'Should have exactly one Stardock sector');
    const stardockId = sectorRes.rows[0].id;
    assert.ok(stardockId >= 2, 'Stardock should not be sector 1');

    // Check Class 9 port at Stardock with all quantities and prices 0
    const portRes = await pool.query(
      'SELECT class, fuel, fuel_price, organics, org_price, equipment, equ_price FROM ports WHERE sector_id = $1 AND universe_id = $2', [stardockId, uid]
    );
    assert.equal(portRes.rows.length, 1);
    assert.equal(portRes.rows[0].class, 9);
    assert.equal(portRes.rows[0].fuel, 0);
    assert.equal(portRes.rows[0].fuel_price, 0);
    assert.equal(portRes.rows[0].organics, 0);
    assert.equal(portRes.rows[0].org_price, 0);
    assert.equal(portRes.rows[0].equipment, 0);
    assert.equal(portRes.rows[0].equ_price, 0);
  });

  it('generates a connected warp graph', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', { name: 'ConnTest', sectors: 30, seed: 777 });
    assert.equal(res.status, 201);
    const uid = res.body.id;

    const warpRes = await pool.query(
      'SELECT sector_from, sector_to FROM warps WHERE universe_id = $1', [uid]
    );
    assert.ok(isConnected(30, warpRes.rows), 'All sectors must be reachable from sector 1');
  });

  it('respects degree constraints (1-6 in/out per sector)', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', { name: 'DegreeTest', sectors: 30, seed: 888 });
    assert.equal(res.status, 201);
    const uid = res.body.id;

    const warpRes = await pool.query(
      'SELECT sector_from, sector_to FROM warps WHERE universe_id = $1', [uid]
    );

    const outDeg = new Map();
    const inDeg = new Map();
    for (let i = 1; i <= 30; i++) { outDeg.set(i, 0); inDeg.set(i, 0); }
    for (const w of warpRes.rows) {
      outDeg.set(w.sector_from, (outDeg.get(w.sector_from) || 0) + 1);
      inDeg.set(w.sector_to, (inDeg.get(w.sector_to) || 0) + 1);
    }
    for (let i = 1; i <= 30; i++) {
      const out = outDeg.get(i);
      const inp = inDeg.get(i);
      assert.ok(out >= 1 && out <= 6, `Sector ${i} has out-degree ${out}, expected 1-6`);
      assert.ok(inp >= 1 && inp <= 6, `Sector ${i} has in-degree ${inp}, expected 1-6`);
    }
  });

  it('respects port density parameter', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'DensityTest', sectors: 40, seed: 555, portDensity: 50,
    });
    assert.equal(res.status, 201);
    const uid = res.body.id;

    // Count trading ports (class 1-8), excluding class 0 and class 9
    const portRes = await pool.query(
      'SELECT COUNT(*) as cnt FROM ports WHERE universe_id = $1 AND class BETWEEN 1 AND 8', [uid]
    );
    const tradingPorts = parseInt(portRes.rows[0].cnt, 10);
    // With 50% density on 40 sectors, expect ~20 trading ports (minus stardock which gets class 9)
    const expected = Math.round(40 * 50 / 100) - 1;
    assert.ok(tradingPorts >= expected - 3 && tradingPorts <= expected + 3,
      `Expected ~${expected} trading ports with 50% density, got ${tradingPorts}`);
  });

  it('respects twoWayPct parameter', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'TwoWayTest', sectors: 30, seed: 444, twoWayPct: 90,
    });
    assert.equal(res.status, 201);
    const uid = res.body.id;

    const warpRes = await pool.query(
      'SELECT sector_from, sector_to FROM warps WHERE universe_id = $1', [uid]
    );
    const warpSet = new Set(warpRes.rows.map(w => `${w.sector_from},${w.sector_to}`));
    let biCount = 0;
    const counted = new Set();
    for (const w of warpRes.rows) {
      const key = `${Math.min(w.sector_from, w.sector_to)},${Math.max(w.sector_from, w.sector_to)}`;
      if (!counted.has(key) && warpSet.has(`${w.sector_to},${w.sector_from}`)) {
        biCount++;
        counted.add(key);
      }
    }
    // bidirectional warps = biCount * 2 out of total
    const biPct = (biCount * 2 / warpRes.rows.length) * 100;
    assert.ok(biPct >= 75 && biPct <= 100,
      `Expected ~90% bidirectional warps, got ${biPct.toFixed(1)}%`);
  });

  it('trading ports have valid commodity quantities and prices', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'PriceTest', sectors: 30, seed: 333,
    });
    assert.equal(res.status, 201);
    const uid = res.body.id;

    const portRes = await pool.query(
      'SELECT * FROM ports WHERE universe_id = $1 AND class BETWEEN 1 AND 8', [uid]
    );
    assert.ok(portRes.rows.length > 0, 'Should have trading ports');

    const CLASS_ACTIONS = {
      1: ['B', 'B', 'S'], 2: ['B', 'S', 'B'], 3: ['S', 'B', 'B'], 4: ['S', 'S', 'B'],
      5: ['B', 'S', 'S'], 6: ['S', 'B', 'S'], 7: ['S', 'S', 'S'], 8: ['B', 'B', 'B'],
    };
    for (const port of portRes.rows) {
      // Quantities 0-5000
      assert.ok(port.fuel >= 0 && port.fuel <= 5000, `Fuel qty ${port.fuel} out of range`);
      assert.ok(port.organics >= 0 && port.organics <= 5000, `Org qty ${port.organics} out of range`);
      assert.ok(port.equipment >= 0 && port.equipment <= 5000, `Equ qty ${port.equipment} out of range`);
      // Prices must match buy/sell tier for the port's class
      const actions = CLASS_ACTIONS[port.class];
      const commodities = [
        { name: 'fuel', action: actions[0], price: port.fuel_price },
        { name: 'organics', action: actions[1], price: port.org_price },
        { name: 'equipment', action: actions[2], price: port.equ_price },
      ];
      for (const c of commodities) {
        if (c.action === 'S') {
          assert.ok(c.price >= 10 && c.price <= 50,
            `Class ${port.class} sector ${port.sector_id}: ${c.name} is Sell, price ${c.price} should be 10-50`);
        } else {
          assert.ok(c.price >= 51 && c.price <= 100,
            `Class ${port.class} sector ${port.sector_id}: ${c.name} is Buy, price ${c.price} should be 51-100`);
        }
      }
    }
  });

  it('accepts admin API key authentication', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'ApiKeyTest', sectors: 20, seed: 111,
    });
    assert.equal(res.status, 201);
  });

  it('accepts admin JWT authentication', async () => {
    const { token } = await createAdminUser(pool);
    const res = await adminPost('/api/admin/universes/generate', {
      name: 'JwtTest', sectors: 20, seed: 222,
    }, token);
    assert.equal(res.status, 201);
  });
});

describe('Admin API - Universe Stats', () => {
  let universeId;

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'StatsUniverse', sectors: 25, seed: 4444,
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;
  });

  it('returns correct stats for an existing universe', async () => {
    const res = await adminKeyGet(`/api/admin/universes/${universeId}/stats`);
    assert.equal(res.status, 200);
    assert.equal(res.body.id, universeId);
    assert.equal(res.body.name, 'StatsUniverse');
    assert.equal(res.body.sectorCount, 25);
    assert.ok(res.body.warpCount > 0);
    assert.ok(res.body.portCount > 0);
    assert.equal(typeof res.body.playerCount, 'number');
    assert.ok(res.body.createdAt, 'Should have createdAt');
    assert.equal(typeof res.body.seed, 'number');
  });

  it('returns 404 for non-existent universe', async () => {
    const res = await adminKeyGet('/api/admin/universes/99999/stats');
    assert.equal(res.status, 404);
    assert.ok(res.body.error.toLowerCase().includes('not found'));
  });
});

describe('Admin API - Delete Universe', () => {
  it('deletes a universe and all associated data', async () => {
    // Create a universe first
    const createRes = await adminKeyPost('/api/admin/universes/generate', {
      name: 'ToDelete', sectors: 20, seed: 5555,
    });
    assert.equal(createRes.status, 201);
    const uid = createRes.body.id;

    // Verify data exists
    const sectorsBefore = await pool.query('SELECT COUNT(*) FROM sectors WHERE universe_id = $1', [uid]);
    assert.ok(parseInt(sectorsBefore.rows[0].count, 10) > 0, 'Should have sectors before delete');

    // Delete
    const delRes = await adminKeyDelete(`/api/admin/universes/${uid}`);
    assert.equal(delRes.status, 200);
    assert.equal(delRes.body.deleted, true);
    assert.equal(delRes.body.id, uid);

    // Verify all data is gone
    const sectorsAfter = await pool.query('SELECT COUNT(*) FROM sectors WHERE universe_id = $1', [uid]);
    assert.equal(parseInt(sectorsAfter.rows[0].count, 10), 0, 'Sectors should be deleted');
    const warpsAfter = await pool.query('SELECT COUNT(*) FROM warps WHERE universe_id = $1', [uid]);
    assert.equal(parseInt(warpsAfter.rows[0].count, 10), 0, 'Warps should be deleted');
    const portsAfter = await pool.query('SELECT COUNT(*) FROM ports WHERE universe_id = $1', [uid]);
    assert.equal(parseInt(portsAfter.rows[0].count, 10), 0, 'Ports should be deleted');
    const univAfter = await pool.query('SELECT COUNT(*) FROM universes WHERE id = $1', [uid]);
    assert.equal(parseInt(univAfter.rows[0].count, 10), 0, 'Universe row should be deleted');
  });

  it('cascade deletes player data', async () => {
    // Create a universe
    const createRes = await adminKeyPost('/api/admin/universes/generate', {
      name: 'CascadeDelete', sectors: 20, seed: 6666,
    });
    assert.equal(createRes.status, 201);
    const uid = createRes.body.id;

    // Create a user and player in this universe
    const { userId } = await createAdminUser(pool);
    const playerRes = await pool.query(
      'INSERT INTO players (name, user_id, universe_id, current_sector) VALUES ($1, $2, $3, 1) RETURNING id',
      ['TestPlayer', userId, uid],
    );
    const playerId = playerRes.rows[0].id;
    await pool.query(
      'INSERT INTO player_ships (player_id, ship_name, fighters, shields, cargo_limit) VALUES ($1, $2, 0, 0, 5)',
      [playerId, 'Merchant Freighter'],
    );
    await pool.query(
      'INSERT INTO ship_cargo (player_id, fuel, organics, equipment, credits) VALUES ($1, 0, 0, 0, 10000)',
      [playerId],
    );
    await pool.query(
      'INSERT INTO visited_sectors (player_id, sector_id) VALUES ($1, 1) ON CONFLICT DO NOTHING',
      [playerId],
    );

    // Verify the data was actually inserted before we delete
    const visitedBefore = await pool.query('SELECT COUNT(*) FROM visited_sectors WHERE player_id = $1', [playerId]);
    assert.ok(parseInt(visitedBefore.rows[0].count, 10) >= 1, 'Should have visited_sectors before delete');

    // Delete the universe
    const delRes = await adminKeyDelete(`/api/admin/universes/${uid}`);
    assert.equal(delRes.status, 200);

    // Small delay to ensure transaction is fully visible
    await new Promise(r => setTimeout(r, 100));

    // Verify player data is gone
    const players = await pool.query('SELECT COUNT(*) FROM players WHERE universe_id = $1', [uid]);
    assert.equal(parseInt(players.rows[0].count, 10), 0, 'Players should be deleted');
    const ships = await pool.query('SELECT COUNT(*) FROM player_ships WHERE player_id = $1', [playerId]);
    assert.equal(parseInt(ships.rows[0].count, 10), 0, 'Player ships should be deleted');
    const cargo = await pool.query('SELECT COUNT(*) FROM ship_cargo WHERE player_id = $1', [playerId]);
    assert.equal(parseInt(cargo.rows[0].count, 10), 0, 'Ship cargo should be deleted');
    const visited = await pool.query('SELECT COUNT(*) FROM visited_sectors WHERE player_id = $1', [playerId]);
    assert.equal(parseInt(visited.rows[0].count, 10), 0, 'Visited sectors should be deleted');
  });

  it('returns 404 for non-existent universe', async () => {
    const res = await adminKeyDelete('/api/admin/universes/99999');
    assert.equal(res.status, 404);
    assert.ok(res.body.error.toLowerCase().includes('not found'));
  });
});

describe('Admin API - Rename Universe', () => {
  let universeId;

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'OriginalName', sectors: 20, seed: 7777,
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;
  });

  it('renames a universe successfully', async () => {
    const res = await adminKeyPut(`/api/admin/universes/${universeId}`, { name: 'RenamedUniverse' });
    assert.equal(res.status, 200);
    assert.equal(res.body.id, universeId);
    assert.equal(res.body.name, 'RenamedUniverse');

    // Verify in DB
    const dbRes = await pool.query('SELECT name FROM universes WHERE id = $1', [universeId]);
    assert.equal(dbRes.rows[0].name, 'RenamedUniverse');
  });

  it('returns 400 when name is missing', async () => {
    const res = await adminKeyPut(`/api/admin/universes/${universeId}`, {});
    assert.equal(res.status, 400);
  });

  it('returns 400 when name is empty', async () => {
    const res = await adminKeyPut(`/api/admin/universes/${universeId}`, { name: '' });
    assert.equal(res.status, 400);
  });

  it('returns 404 for non-existent universe', async () => {
    const res = await adminKeyPut('/api/admin/universes/99999', { name: 'Whatever' });
    assert.equal(res.status, 404);
    assert.ok(res.body.error.toLowerCase().includes('not found'));
  });
});

describe('Admin API - Clone Universe', () => {
  let sourceId;
  let sourceStats;

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'CloneSource', sectors: 25, seed: 8888,
    });
    assert.equal(res.status, 201);
    sourceId = res.body.id;
    const statsRes = await adminKeyGet(`/api/admin/universes/${sourceId}/stats`);
    sourceStats = statsRes.body;
  });

  it('clones a universe with all sectors, warps, and ports', async () => {
    const res = await adminKeyPost(`/api/admin/universes/${sourceId}/clone`, { name: 'ClonedUniverse' });
    assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.id !== sourceId, 'Cloned universe must have a different ID');
    assert.equal(res.body.name, 'ClonedUniverse');
    assert.equal(res.body.seed, sourceStats.seed, 'Cloned universe must copy seed from source');
    assert.equal(res.body.sectorCount, sourceStats.sectorCount);
    assert.equal(res.body.warpCount, sourceStats.warpCount);
    assert.equal(res.body.portCount, sourceStats.portCount);
  });

  it('cloned universe has matching sector data', async () => {
    const res = await adminKeyPost(`/api/admin/universes/${sourceId}/clone`, { name: 'CloneCheck' });
    assert.equal(res.status, 201);
    const cloneId = res.body.id;

    // Check Federation Space exists at sector 1
    const fedRes = await pool.query(
      'SELECT name FROM sectors WHERE id = 1 AND universe_id = $1', [cloneId]
    );
    assert.equal(fedRes.rows[0].name, 'Federation Space');

    // Check Class 0 port at sector 1
    const port0 = await pool.query(
      'SELECT class FROM ports WHERE sector_id = 1 AND universe_id = $1', [cloneId]
    );
    assert.equal(port0.rows.length, 1);
    assert.equal(port0.rows[0].class, 0);

    // Check Stardock with Class 9
    const sdRes = await pool.query(
      'SELECT s.id FROM sectors s JOIN ports p ON p.sector_id = s.id AND p.universe_id = s.universe_id WHERE s.name = $1 AND s.universe_id = $2 AND p.class = 9',
      ['Stardock', cloneId]
    );
    assert.equal(sdRes.rows.length, 1, 'Cloned universe must have Stardock with Class 9 port');
  });

  it('cloned universe does not copy players', async () => {
    // Add a player to the source universe
    const { userId } = await createAdminUser(pool);
    await pool.query(
      'INSERT INTO players (name, user_id, universe_id, current_sector) VALUES ($1, $2, $3, 1)',
      ['SourcePlayer', userId, sourceId],
    );

    const res = await adminKeyPost(`/api/admin/universes/${sourceId}/clone`, { name: 'NoPlayers' });
    assert.equal(res.status, 201);
    const cloneId = res.body.id;

    const players = await pool.query('SELECT COUNT(*) FROM players WHERE universe_id = $1', [cloneId]);
    assert.equal(parseInt(players.rows[0].count, 10), 0, 'Cloned universe should have no players');
  });

  it('clone copies actual DB data, not re-generated data', async () => {
    // Modify a port in the source universe before cloning
    const tradingPort = await pool.query(
      'SELECT sector_id, class FROM ports WHERE universe_id = $1 AND class BETWEEN 1 AND 8 LIMIT 1',
      [sourceId],
    );
    assert.ok(tradingPort.rows.length > 0);
    const modSector = tradingPort.rows[0].sector_id;

    // Set a distinctive quantity that wouldn't come from generation
    await pool.query(
      'UPDATE ports SET fuel = 4999 WHERE sector_id = $1 AND universe_id = $2',
      [modSector, sourceId],
    );

    const res = await adminKeyPost(`/api/admin/universes/${sourceId}/clone`, { name: 'ModifiedClone' });
    assert.equal(res.status, 201);
    const cloneId = res.body.id;

    // The cloned port must have the modified value, not the original generated value
    const clonedPort = await pool.query(
      'SELECT fuel FROM ports WHERE sector_id = $1 AND universe_id = $2',
      [modSector, cloneId],
    );
    assert.equal(clonedPort.rows.length, 1);
    assert.equal(clonedPort.rows[0].fuel, 4999, 'Clone must copy actual DB data, not re-generate');
  });

  it('returns 400 when name is missing', async () => {
    const res = await adminKeyPost(`/api/admin/universes/${sourceId}/clone`, {});
    assert.equal(res.status, 400);
  });

  it('returns 404 for non-existent source universe', async () => {
    const res = await adminKeyPost('/api/admin/universes/99999/clone', { name: 'Ghost' });
    assert.equal(res.status, 404);
    assert.ok(res.body.error.toLowerCase().includes('not found'));
  });
});

describe('Admin API - List Ports', () => {
  let universeId;

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'PortListUniverse', sectors: 20, seed: 11111,
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;
  });

  it('returns all ports sorted by sectorId', async () => {
    const res = await adminKeyGet(`/api/admin/universes/${universeId}/ports`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body), 'Should return an array');
    assert.ok(res.body.length > 0, 'Should have ports');

    // Check sorted by sectorId
    for (let i = 1; i < res.body.length; i++) {
      assert.ok(res.body[i].sectorId > res.body[i - 1].sectorId,
        `Ports not sorted: sector ${res.body[i - 1].sectorId} before ${res.body[i].sectorId}`);
    }

    // Check port object shape
    const port = res.body[0];
    assert.ok('sectorId' in port, 'Should have sectorId');
    assert.ok('class' in port, 'Should have class');
    assert.ok('fuel' in port, 'Should have fuel');
    assert.ok('fuelPrice' in port, 'Should have fuelPrice');
    assert.ok('organics' in port, 'Should have organics');
    assert.ok('orgPrice' in port, 'Should have orgPrice');
    assert.ok('equipment' in port, 'Should have equipment');
    assert.ok('equPrice' in port, 'Should have equPrice');
  });

  it('includes Class 0 and Class 9 special ports', async () => {
    const res = await adminKeyGet(`/api/admin/universes/${universeId}/ports`);
    assert.equal(res.status, 200);
    const classes = res.body.map(p => p.class);
    assert.ok(classes.includes(0), 'Should include Class 0 port');
    assert.ok(classes.includes(9), 'Should include Class 9 port');
  });

  it('returns 404 for non-existent universe', async () => {
    const res = await adminKeyGet('/api/admin/universes/99999/ports');
    assert.equal(res.status, 404);
  });
});

describe('Admin API - Update Port', () => {
  let universeId;
  let tradingPortSector;

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'PortEditUniverse', sectors: 20, seed: 22222,
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;

    // Find a trading port (class 1-8)
    const ports = await pool.query(
      'SELECT sector_id, class FROM ports WHERE universe_id = $1 AND class BETWEEN 1 AND 8 LIMIT 1',
      [universeId],
    );
    assert.ok(ports.rows.length > 0, 'Should have at least one trading port');
    tradingPortSector = ports.rows[0].sector_id;
  });

  it('updates a port quantity', async () => {
    const res = await adminKeyPut(
      `/api/admin/universes/${universeId}/ports/${tradingPortSector}`,
      { fuel: 2500 },
    );
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.fuel, 2500);
    assert.equal(res.body.sectorId, tradingPortSector);
  });

  it('updates a port class with valid prices', async () => {
    // Class 3: Sell fuel, Buy organics, Buy equipment
    // Sell prices: 10-50, Buy prices: 51-100
    const res = await adminKeyPut(
      `/api/admin/universes/${universeId}/ports/${tradingPortSector}`,
      { class: 3, fuelPrice: 25, orgPrice: 75, equPrice: 80, fuel: 1000, organics: 2000, equipment: 3000 },
    );
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.class, 3);
    assert.equal(res.body.fuelPrice, 25);
    assert.equal(res.body.orgPrice, 75);
  });

  it('rejects price that violates buy/sell rules for class', async () => {
    // Class 1: Buy fuel (51-100), Buy organics (51-100), Sell equipment (10-50)
    // Setting fuelPrice to 25 violates Buy range
    const res = await adminKeyPut(
      `/api/admin/universes/${universeId}/ports/${tradingPortSector}`,
      { class: 1, fuelPrice: 25, orgPrice: 75, equPrice: 30 },
    );
    assert.equal(res.status, 400, `Expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.error, 'Should have error message');
  });

  it('rejects class change when existing prices become invalid', async () => {
    // First set port to class 3 with valid prices: Sell fuel (25), Buy org (75), Buy equ (80)
    await adminKeyPut(
      `/api/admin/universes/${universeId}/ports/${tradingPortSector}`,
      { class: 3, fuelPrice: 25, orgPrice: 75, equPrice: 80 },
    );
    // Now change to class 1: Buy fuel (51-100), Buy org (51-100), Sell equ (10-50)
    // fuelPrice=25 is invalid for Buy, equPrice=80 is invalid for Sell
    const res = await adminKeyPut(
      `/api/admin/universes/${universeId}/ports/${tradingPortSector}`,
      { class: 1 },
    );
    assert.equal(res.status, 400, `Expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  it('rejects invalid class value', async () => {
    const res = await adminKeyPut(
      `/api/admin/universes/${universeId}/ports/${tradingPortSector}`,
      { class: 99 },
    );
    assert.equal(res.status, 400);
  });

  it('rejects quantity out of range', async () => {
    const res = await adminKeyPut(
      `/api/admin/universes/${universeId}/ports/${tradingPortSector}`,
      { fuel: 9999 },
    );
    assert.equal(res.status, 400);
  });

  it('rejects modification of Class 0 port', async () => {
    const res = await adminKeyPut(
      `/api/admin/universes/${universeId}/ports/1`,
      { fuel: 100 },
    );
    assert.equal(res.status, 403);
    assert.ok(res.body.error.toLowerCase().includes('special'));
  });

  it('rejects modification of Class 9 port', async () => {
    const stardock = await pool.query(
      "SELECT sector_id FROM ports WHERE universe_id = $1 AND class = 9", [universeId]
    );
    assert.ok(stardock.rows.length > 0);
    const res = await adminKeyPut(
      `/api/admin/universes/${universeId}/ports/${stardock.rows[0].sector_id}`,
      { fuel: 100 },
    );
    assert.equal(res.status, 403);
  });

  it('returns 404 for non-existent port', async () => {
    const res = await adminKeyPut(
      `/api/admin/universes/${universeId}/ports/99999`,
      { fuel: 100 },
    );
    assert.equal(res.status, 404);
  });

  it('returns 404 for non-existent universe', async () => {
    const res = await adminKeyPut('/api/admin/universes/99999/ports/1', { fuel: 100 });
    assert.equal(res.status, 404);
  });
});

describe('Admin API - Create Port', () => {
  let universeId;
  let emptySector;

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'PortCreateUniverse', sectors: 30, seed: 33333, portDensity: 20,
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;

    // Find a sector without a port
    const result = await pool.query(
      `SELECT s.id FROM sectors s LEFT JOIN ports p ON p.sector_id = s.id AND p.universe_id = s.universe_id
       WHERE s.universe_id = $1 AND p.id IS NULL AND s.id > 1
       ORDER BY s.id LIMIT 1`,
      [universeId],
    );
    assert.ok(result.rows.length > 0, 'Should have a sector without a port');
    emptySector = result.rows[0].id;
  });

  it('creates a port with valid data', async () => {
    // Class 2: Buy fuel (51-100), Sell organics (10-50), Buy equipment (51-100)
    const res = await adminKeyPost(
      `/api/admin/universes/${universeId}/ports/${emptySector}`,
      { class: 2, fuel: 1000, fuelPrice: 75, organics: 2000, orgPrice: 30, equipment: 500, equPrice: 90 },
    );
    assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.sectorId, emptySector);
    assert.equal(res.body.class, 2);
    assert.equal(res.body.fuel, 1000);
    assert.equal(res.body.fuelPrice, 75);
  });

  it('rejects invalid price for port class', async () => {
    // Find another empty sector
    const result = await pool.query(
      `SELECT s.id FROM sectors s LEFT JOIN ports p ON p.sector_id = s.id AND p.universe_id = s.universe_id
       WHERE s.universe_id = $1 AND p.id IS NULL AND s.id > 1
       ORDER BY s.id LIMIT 1`,
      [universeId],
    );
    assert.ok(result.rows.length > 0);
    const sector = result.rows[0].id;

    // Class 5: Buy fuel (51-100), Sell organics (10-50), Sell equipment (10-50)
    // Setting fuelPrice to 30 violates Buy range
    const res = await adminKeyPost(
      `/api/admin/universes/${universeId}/ports/${sector}`,
      { class: 5, fuel: 100, fuelPrice: 30, organics: 100, orgPrice: 20, equipment: 100, equPrice: 20 },
    );
    assert.equal(res.status, 400);
    assert.ok(res.body.error, 'Should have error about price');
  });

  it('rejects class 0 or class 9 creation', async () => {
    const result = await pool.query(
      `SELECT s.id FROM sectors s LEFT JOIN ports p ON p.sector_id = s.id AND p.universe_id = s.universe_id
       WHERE s.universe_id = $1 AND p.id IS NULL AND s.id > 1
       ORDER BY s.id LIMIT 1`,
      [universeId],
    );
    const sector = result.rows[0].id;

    const res0 = await adminKeyPost(
      `/api/admin/universes/${universeId}/ports/${sector}`,
      { class: 0, fuel: 0, fuelPrice: 0, organics: 0, orgPrice: 0, equipment: 0, equPrice: 0 },
    );
    assert.equal(res0.status, 400);

    const res9 = await adminKeyPost(
      `/api/admin/universes/${universeId}/ports/${sector}`,
      { class: 9, fuel: 0, fuelPrice: 0, organics: 0, orgPrice: 0, equipment: 0, equPrice: 0 },
    );
    assert.equal(res9.status, 400);
  });

  it('rejects missing required fields', async () => {
    const result = await pool.query(
      `SELECT s.id FROM sectors s LEFT JOIN ports p ON p.sector_id = s.id AND p.universe_id = s.universe_id
       WHERE s.universe_id = $1 AND p.id IS NULL AND s.id > 1
       ORDER BY s.id LIMIT 1`,
      [universeId],
    );
    assert.ok(result.rows.length > 0);
    const sector = result.rows[0].id;

    // Missing fuelPrice
    const res = await adminKeyPost(
      `/api/admin/universes/${universeId}/ports/${sector}`,
      { class: 1, fuel: 100, organics: 100, orgPrice: 80, equipment: 100, equPrice: 30 },
    );
    assert.equal(res.status, 400);
  });

  it('rejects duplicate port (409)', async () => {
    // emptySector already has a port from the first test
    const res = await adminKeyPost(
      `/api/admin/universes/${universeId}/ports/${emptySector}`,
      { class: 1, fuel: 100, fuelPrice: 75, organics: 100, orgPrice: 80, equipment: 100, equPrice: 30 },
    );
    assert.equal(res.status, 409);
  });

  it('rejects quantity out of range on create', async () => {
    const result = await pool.query(
      `SELECT s.id FROM sectors s LEFT JOIN ports p ON p.sector_id = s.id AND p.universe_id = s.universe_id
       WHERE s.universe_id = $1 AND p.id IS NULL AND s.id > 1
       ORDER BY s.id LIMIT 1`,
      [universeId],
    );
    assert.ok(result.rows.length > 0);
    const sector = result.rows[0].id;

    const res = await adminKeyPost(
      `/api/admin/universes/${universeId}/ports/${sector}`,
      { class: 1, fuel: 9999, fuelPrice: 75, organics: 100, orgPrice: 80, equipment: 100, equPrice: 30 },
    );
    assert.equal(res.status, 400);
  });

  it('rejects non-existent sector', async () => {
    const res = await adminKeyPost(
      `/api/admin/universes/${universeId}/ports/99999`,
      { class: 1, fuel: 100, fuelPrice: 75, organics: 100, orgPrice: 80, equipment: 100, equPrice: 30 },
    );
    assert.equal(res.status, 404);
  });

  it('returns 404 for non-existent universe', async () => {
    const res = await adminKeyPost(
      '/api/admin/universes/99999/ports/1',
      { class: 1, fuel: 100, fuelPrice: 75, organics: 100, orgPrice: 80, equipment: 100, equPrice: 30 },
    );
    assert.equal(res.status, 404);
  });
});

describe('Admin API - Delete Port', () => {
  let universeId;
  let tradingPortSector;

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'PortDeleteUniverse', sectors: 20, seed: 44444,
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;

    const ports = await pool.query(
      'SELECT sector_id FROM ports WHERE universe_id = $1 AND class BETWEEN 1 AND 8 LIMIT 1',
      [universeId],
    );
    assert.ok(ports.rows.length > 0);
    tradingPortSector = ports.rows[0].sector_id;
  });

  it('deletes a trading port', async () => {
    const res = await adminKeyDelete(`/api/admin/universes/${universeId}/ports/${tradingPortSector}`);
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.deleted, true);
    assert.equal(res.body.sectorId, tradingPortSector);

    // Verify it's gone
    const check = await pool.query(
      'SELECT COUNT(*) FROM ports WHERE sector_id = $1 AND universe_id = $2',
      [tradingPortSector, universeId],
    );
    assert.equal(parseInt(check.rows[0].count, 10), 0);
  });

  it('rejects deletion of Class 0 port', async () => {
    const res = await adminKeyDelete(`/api/admin/universes/${universeId}/ports/1`);
    assert.equal(res.status, 403);
    assert.ok(res.body.error.toLowerCase().includes('special'));
  });

  it('rejects deletion of Class 9 port', async () => {
    const stardock = await pool.query(
      "SELECT sector_id FROM ports WHERE universe_id = $1 AND class = 9", [universeId]
    );
    assert.ok(stardock.rows.length > 0);
    const res = await adminKeyDelete(
      `/api/admin/universes/${universeId}/ports/${stardock.rows[0].sector_id}`,
    );
    assert.equal(res.status, 403);
  });

  it('returns 404 for non-existent port', async () => {
    const res = await adminKeyDelete(`/api/admin/universes/${universeId}/ports/99999`);
    assert.equal(res.status, 404);
  });

  it('returns 404 for non-existent universe', async () => {
    const res = await adminKeyDelete('/api/admin/universes/99999/ports/1');
    assert.equal(res.status, 404);
  });
});

describe('Admin API - Topology', () => {
  let universeId;

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'TopoUniverse', sectors: 30, seed: 9999, twoWayPct: 90,
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;
  });

  it('returns correct topology analysis', async () => {
    const res = await adminKeyGet(`/api/admin/universes/${universeId}/topology`);
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);

    // Check all required fields exist and have correct types
    assert.equal(res.body.totalSectors, 30);
    assert.equal(typeof res.body.totalWarps, 'number');
    assert.ok(res.body.totalWarps > 0);
    assert.equal(typeof res.body.bidirectionalPairs, 'number');
    assert.ok(res.body.bidirectionalPairs >= 0);
    assert.equal(typeof res.body.averageOutDegree, 'number');
    assert.ok(res.body.averageOutDegree >= 1 && res.body.averageOutDegree <= 6);
    assert.ok(Array.isArray(res.body.deadEndSectors));
    assert.equal(typeof res.body.isConnected, 'boolean');
  });

  it('bidirectionalPairs counts each pair once', async () => {
    const res = await adminKeyGet(`/api/admin/universes/${universeId}/topology`);
    assert.equal(res.status, 200);

    // Verify against actual DB data
    const warps = await pool.query(
      'SELECT sector_from, sector_to FROM warps WHERE universe_id = $1', [universeId]
    );
    const warpSet = new Set(warps.rows.map(w => `${w.sector_from},${w.sector_to}`));
    let biPairs = 0;
    const counted = new Set();
    for (const w of warps.rows) {
      const key = `${Math.min(w.sector_from, w.sector_to)},${Math.max(w.sector_from, w.sector_to)}`;
      if (!counted.has(key) && warpSet.has(`${w.sector_to},${w.sector_from}`)) {
        biPairs++;
        counted.add(key);
      }
    }
    assert.equal(res.body.bidirectionalPairs, biPairs,
      `Expected ${biPairs} bidirectional pairs, got ${res.body.bidirectionalPairs}`);
  });

  it('averageOutDegree and deadEndSectors match actual DB data', async () => {
    const res = await adminKeyGet(`/api/admin/universes/${universeId}/topology`);
    assert.equal(res.status, 200);

    // Compute expected values from DB
    const warps = await pool.query(
      'SELECT sector_from, sector_to FROM warps WHERE universe_id = $1', [universeId]
    );
    const outDeg = new Map();
    for (let i = 1; i <= 30; i++) outDeg.set(i, 0);
    for (const w of warps.rows) {
      outDeg.set(w.sector_from, (outDeg.get(w.sector_from) || 0) + 1);
    }

    const expectedAvg = Math.round((warps.rows.length / 30) * 100) / 100;
    assert.equal(res.body.averageOutDegree, expectedAvg,
      `Expected averageOutDegree ${expectedAvg}, got ${res.body.averageOutDegree}`);

    const expectedDeadEnds = [];
    for (const [sector, deg] of outDeg) {
      if (deg === 1) expectedDeadEnds.push(sector);
    }
    expectedDeadEnds.sort((a, b) => a - b);
    assert.deepStrictEqual(res.body.deadEndSectors, expectedDeadEnds,
      `deadEndSectors mismatch`);
  });

  it('averageOutDegree is rounded to 2 decimal places', async () => {
    const res = await adminKeyGet(`/api/admin/universes/${universeId}/topology`);
    assert.equal(res.status, 200);
    const str = String(res.body.averageOutDegree);
    const decimals = str.includes('.') ? str.split('.')[1].length : 0;
    assert.ok(decimals <= 2, `averageOutDegree should have at most 2 decimal places, got ${str}`);
  });

  it('isConnected is true for a generated universe', async () => {
    const res = await adminKeyGet(`/api/admin/universes/${universeId}/topology`);
    assert.equal(res.status, 200);
    assert.equal(res.body.isConnected, true, 'Generated universe should be connected');
  });

  it('returns 404 for non-existent universe', async () => {
    const res = await adminKeyGet('/api/admin/universes/99999/topology');
    assert.equal(res.status, 404);
    assert.ok(res.body.error.toLowerCase().includes('not found'));
  });
});

// Setup and teardown
before(async () => {
  pool = createPool();

  // Ensure schema exists
  const client = await pool.connect();
  try {
    await client.query(`
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
        id INTEGER NOT NULL,
        universe_id INTEGER NOT NULL REFERENCES universes(id),
        name VARCHAR(255),
        PRIMARY KEY (id, universe_id)
      );
      CREATE TABLE IF NOT EXISTS warps (
        sector_from INTEGER NOT NULL,
        sector_to INTEGER NOT NULL,
        universe_id INTEGER NOT NULL REFERENCES universes(id),
        PRIMARY KEY (sector_from, sector_to, universe_id)
      );
      CREATE TABLE IF NOT EXISTS players (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255),
        user_id INTEGER NOT NULL REFERENCES users(id),
        universe_id INTEGER NOT NULL REFERENCES universes(id),
        current_sector INTEGER,
        ship_destroyed_date TIMESTAMPTZ,
        docked BOOLEAN NOT NULL DEFAULT FALSE,
        UNIQUE (user_id, universe_id)
      );
      CREATE TABLE IF NOT EXISTS ports (
        id SERIAL PRIMARY KEY,
        sector_id INTEGER NOT NULL,
        universe_id INTEGER NOT NULL REFERENCES universes(id),
        class INTEGER NOT NULL,
        fuel INTEGER NOT NULL DEFAULT 1000,
        fuel_price INTEGER NOT NULL,
        organics INTEGER NOT NULL DEFAULT 1000,
        org_price INTEGER NOT NULL,
        equipment INTEGER NOT NULL DEFAULT 1000,
        equ_price INTEGER NOT NULL,
        UNIQUE (sector_id, universe_id)
      );
      CREATE TABLE IF NOT EXISTS ship_cargo (
        player_id INTEGER PRIMARY KEY,
        fuel INTEGER NOT NULL DEFAULT 0,
        organics INTEGER NOT NULL DEFAULT 0,
        equipment INTEGER NOT NULL DEFAULT 0,
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
        fighters INTEGER NOT NULL DEFAULT 0,
        shields INTEGER NOT NULL DEFAULT 0,
        cargo_limit INTEGER NOT NULL
      );
    `);
  } finally {
    client.release();
  }

  serverProc = await startServer();
});

after(async () => {
  if (serverProc) {
    serverProc.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 1000));
  }
  if (pool) await pool.end();
});

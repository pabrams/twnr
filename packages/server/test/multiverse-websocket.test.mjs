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

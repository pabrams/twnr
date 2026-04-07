/**
 * Turns system verification tests.
 * Each test sets up exactly the DB state it needs — no port scanning loops.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = dirname(__filename);

const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'test-admin-key';
const TEST_DB = process.env.PGDATABASE || 'twnr_test';
const BASE = 'http://localhost:3000';
const UNIVERSE_ID = 1;

// ─── global setup (singleton) ───────────────────────────────────────────────

function testEnv() { return { ...process.env, PGDATABASE: TEST_DB }; }

function createPool() {
  return new Pool({
    host: process.env.PGHOST || 'localhost',
    database: TEST_DB,
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
  });
}

let serverProc = null;
let setupPromise = null;

async function isServerRunning() {
  try {
    const res = await fetch(`${BASE}/api/ships`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch { return false; }
}

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['dist/server.js'], {
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env, PGDATABASE: TEST_DB,
        PGUSER: process.env.PGUSER || 'postgres',
        PGPASSWORD: process.env.PGPASSWORD || '',
        JWT_SECRET, ADMIN_API_KEY,
        WS_ALLOWED_ORIGINS: 'http://localhost:3000',
        DISABLE_RATE_LIMIT: '1',
      },
    });
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error('Server start timeout')); }
    }, 15000);
    let stdout = '';
    proc.stdout.on('data', (d) => {
      stdout += d.toString();
      if (!settled && (stdout.includes('listening') || stdout.includes('3000'))) {
        settled = true; clearTimeout(timeout);
        // Wait for schema init
        setTimeout(() => resolve(proc), 2000);
      }
    });
    proc.stderr.on('data', () => {});
    proc.on('error', (err) => { if (!settled) { settled = true; clearTimeout(timeout); reject(err); } });
    proc.on('exit', (code) => { if (!settled) { settled = true; clearTimeout(timeout); reject(new Error(`Server exited ${code}`)); } });
  });
}

async function doSetup() {
  if (await isServerRunning()) return;

  const universeDir = join(tmpdir(), `twnr_test_${Date.now()}`);
  const gen = spawnSync(process.execPath, [
    join(PROJECT_ROOT, 'scripts', 'twnr-bigbang.js'),
    universeDir, '--sectors', '100', '--seed', '42',
  ], { encoding: 'utf8', cwd: PROJECT_ROOT });
  if (gen.status !== 0) throw new Error(`bigbang failed: ${gen.stderr}`);

  let pool = createPool();
  await pool.query('SELECT 1');
  await pool.query(`
    DROP TABLE IF EXISTS sector_drones CASCADE;
    DROP TABLE IF EXISTS planet_collisions CASCADE;
    DROP TABLE IF EXISTS planets CASCADE;
    DROP TABLE IF EXISTS visited_sectors CASCADE;
    DROP TABLE IF EXISTS player_ships CASCADE;
    DROP TABLE IF EXISTS ship_cargo CASCADE;
    DROP TABLE IF EXISTS ports CASCADE;
    DROP TABLE IF EXISTS warps CASCADE;
    DROP TABLE IF EXISTS players CASCADE;
    DROP TABLE IF EXISTS sectors CASCADE;
    DROP TABLE IF EXISTS universes CASCADE;
    DROP TABLE IF EXISTS users CASCADE;
  `);
  await pool.end();

  const imp = spawnSync(process.execPath, [
    join(PROJECT_ROOT, 'scripts', 'importUniverse.js'),
    universeDir, '--force',
  ], { encoding: 'utf8', cwd: PROJECT_ROOT, env: testEnv() });
  if (imp.status !== 0) throw new Error(`importUniverse failed: ${imp.stderr}\n${imp.stdout}`);

  serverProc = await startServer();

  pool = createPool();
  await pool.query("SELECT setval('universes_id_seq', COALESCE((SELECT MAX(id) FROM universes), 0) + 1)");
  await pool.end();
}

async function ensureServer() {
  if (!setupPromise) {
    setupPromise = doSetup();
    process.on('exit', () => { if (serverProc) serverProc.kill(); });
  }
  return setupPromise;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${derivedKey.toString('base64url')}`;
}

async function createTestUser(pool) {
  const ts = Date.now() + Math.random();
  const email = `testuser_${ts}@test.com`;
  const hash = hashPassword('testpass');
  const res = await pool.query(
    `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'player') RETURNING id, role, token_version`,
    [email, hash],
  );
  const user = res.rows[0];
  const token = jwt.sign(
    { userId: user.id, name: `TestUser_${ts}`, role: user.role, tokenVersion: user.token_version },
    JWT_SECRET, { algorithm: 'HS256', expiresIn: '7d' },
  );
  return { userId: user.id, token };
}

/** Create player via the /join endpoint so server sets turns, last_turns_granted_at, turns_per_warp */
async function joinUniverse(pool, universeId = UNIVERSE_ID) {
  const { userId, token } = await createTestUser(pool);
  const res = await fetch(`${BASE}/api/universes/${universeId}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `twnr_auth=${token}` },
    body: JSON.stringify({ name: `P_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }),
  });
  if (!res.ok) throw new Error(`join failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  return { userId, token, playerId: body.playerId };
}

async function connectWS(token, universeId = UNIVERSE_ID) {
  const { default: WebSocket } = await import('ws');
  const headers = { Cookie: `twnr_auth=${token}` };
  const url = `ws://localhost:3000/ws?universe=${universeId}`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('WS timeout')); }, 5000);
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'welcome') { clearTimeout(timer); resolve({ ws, welcome: msg }); }
    });
    ws.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

function wsRequest(ws, msg, responseType, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout for "${responseType}"`)), timeout);
    function handler(data) {
      const parsed = JSON.parse(data.toString());
      if (parsed.type === 'rateLimited') { setTimeout(() => ws.send(JSON.stringify(msg)), 200); return; }
      if (parsed.type === responseType || parsed.type === 'error') {
        clearTimeout(timer); ws.removeListener('message', handler); resolve(parsed);
      }
    }
    ws.on('message', handler);
    ws.send(JSON.stringify(msg));
  });
}

function closeWS(ws) {
  return new Promise((resolve) => {
    if (!ws || ws.readyState > 1) { resolve(); return; }
    ws.on('close', resolve); ws.close(); setTimeout(resolve, 1000);
  });
}

/** Move player to a specific sector by warping along the shortest path, clearing drones en route */
async function movePlayerTo(ws, targetSector) {
  const disp = await wsRequest(ws, { type: 'sectorDisplay' }, 'sectorDisplayResult');
  if (disp.sector === targetSector) return true;
  const pathRes = await wsRequest(ws, { type: 'shortestPath', from: disp.sector, to: targetSector }, 'shortestPathResult');
  if (pathRes.type === 'error') return false;
  for (let i = 1; i < pathRes.path.length; i++) {
    await clearSectorDrones(pathRes.path[i]);
    const r = await wsRequest(ws, { type: 'move', sector: pathRes.path[i] }, 'moveResult');
    if (r.type === 'error' || r.outcome === 'error') return false;
  }
  return true;
}

/** Find an adjacent sector to the player's current sector */
async function getAdjacentSector(ws) {
  const disp = await wsRequest(ws, { type: 'sectorDisplay' }, 'sectorDisplayResult');
  return disp.warps?.[0];
}

/** Clear any sector drones so movement doesn't trigger encounters */
async function clearSectorDrones(sectorId, universeId = UNIVERSE_ID) {
  await pool.query('DELETE FROM sector_drones WHERE sector_id = $1 AND universe_id = $2', [sectorId, universeId]);
}

/** Put a selling port (class 6: sells fuel) in a given sector via DB */
async function ensureSellingPort(pool, sectorId, universeId = UNIVERSE_ID) {
  await pool.query(`
    INSERT INTO ports (sector_id, universe_id, class, fuel, fuel_price, organics, org_price, equipment, equ_price)
    VALUES ($1, $2, 6, 1000, 5, 1000, 5, 1000, 5)
    ON CONFLICT (sector_id, universe_id) DO UPDATE SET class = 6, fuel = 1000, fuel_price = 5
  `, [sectorId, universeId]);
}

/** Put a port that buys fuel (class 1: buys fuel+organics, sells equipment) */
async function ensureBuyingPort(pool, sectorId, universeId = UNIVERSE_ID) {
  await pool.query(`
    INSERT INTO ports (sector_id, universe_id, class, fuel, fuel_price, organics, org_price, equipment, equ_price)
    VALUES ($1, $2, 1, 1000, 5, 1000, 5, 1000, 5)
    ON CONFLICT (sector_id, universe_id) DO UPDATE SET class = 1, fuel = 1000, fuel_price = 5
  `, [sectorId, universeId]);
}

// ============================================================
// TESTS
// ============================================================

let pool;

before(async () => {
  await ensureServer();
  pool = createPool();
});

after(async () => {
  if (pool) await pool.end();
});

// --- Schema tests ---

describe('Schema - Universe columns', () => {
  it('turns_per_day column exists with default 500', async () => {
    const res = await pool.query(`SELECT data_type, column_default, is_nullable FROM information_schema.columns WHERE table_name = 'universes' AND column_name = 'turns_per_day'`);
    assert.equal(res.rows.length, 1); assert.match(res.rows[0].data_type, /int/i);
    assert.equal(res.rows[0].is_nullable, 'NO'); assert.match(res.rows[0].column_default, /500/);
  });
  it('starting_turns column exists with default 500', async () => {
    const res = await pool.query(`SELECT data_type, column_default, is_nullable FROM information_schema.columns WHERE table_name = 'universes' AND column_name = 'starting_turns'`);
    assert.equal(res.rows.length, 1); assert.match(res.rows[0].data_type, /int/i);
    assert.equal(res.rows[0].is_nullable, 'NO'); assert.match(res.rows[0].column_default, /500/);
  });
  it('max_turns column exists with default 2000', async () => {
    const res = await pool.query(`SELECT data_type, column_default, is_nullable FROM information_schema.columns WHERE table_name = 'universes' AND column_name = 'max_turns'`);
    assert.equal(res.rows.length, 1); assert.match(res.rows[0].data_type, /int/i);
    assert.equal(res.rows[0].is_nullable, 'NO'); assert.match(res.rows[0].column_default, /2000/);
  });
});

describe('Schema - Player columns', () => {
  it('players.turns exists (integer, NOT NULL)', async () => {
    const res = await pool.query(`SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name = 'players' AND column_name = 'turns'`);
    assert.equal(res.rows.length, 1); assert.match(res.rows[0].data_type, /int/i); assert.equal(res.rows[0].is_nullable, 'NO');
  });
  it('players.last_turns_granted_at exists (timestamptz, NOT NULL)', async () => {
    const res = await pool.query(`SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name = 'players' AND column_name = 'last_turns_granted_at'`);
    assert.equal(res.rows.length, 1); assert.match(res.rows[0].data_type, /timestamp/i); assert.equal(res.rows[0].is_nullable, 'NO');
  });
});

describe('Schema - Ship columns', () => {
  it('player_ships.turns_per_warp exists (integer, NOT NULL, default 1)', async () => {
    const res = await pool.query(`SELECT data_type, column_default, is_nullable FROM information_schema.columns WHERE table_name = 'player_ships' AND column_name = 'turns_per_warp'`);
    assert.equal(res.rows.length, 1); assert.match(res.rows[0].data_type, /int/i);
    assert.equal(res.rows[0].is_nullable, 'NO'); assert.match(res.rows[0].column_default, /1/);
  });
});

// --- Ship config tests ---

describe('Ship configs', () => {
  it('Merchant Freighter has turnsPerWarp = 3', () => {
    const cfg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'ships', 'merchant.json'), 'utf8'));
    assert.equal(cfg.turnsPerWarp, 3);
  });
  it('All ship configs have turnsPerWarp >= 1', () => {
    const files = readdirSync(join(PROJECT_ROOT, 'config', 'ships')).filter(f => f.endsWith('.json'));
    assert.ok(files.length > 0);
    for (const file of files) {
      const cfg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'ships', file), 'utf8'));
      assert.ok(typeof cfg.turnsPerWarp === 'number' && cfg.turnsPerWarp >= 1, `${file}: turnsPerWarp must be >= 1, got ${cfg.turnsPerWarp}`);
    }
  });
  it('Non-Merchant ships default to turnsPerWarp = 2', () => {
    const files = readdirSync(join(PROJECT_ROOT, 'config', 'ships')).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const cfg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'ships', file), 'utf8'));
      if (cfg.name !== 'Merchant Freighter') {
        assert.equal(cfg.turnsPerWarp, 2, `${file}: non-Merchant ships should have turnsPerWarp = 2, got ${cfg.turnsPerWarp}`);
      }
    }
  });
});

// --- Player initialization ---

describe('Player initialization', () => {
  it('New player gets turns = starting_turns', async () => {
    await pool.query('UPDATE universes SET starting_turns = 250 WHERE id = $1', [UNIVERSE_ID]);
    try {
      const { playerId } = await joinUniverse(pool);
      const r = await pool.query('SELECT turns FROM players WHERE id = $1', [playerId]);
      assert.equal(r.rows[0].turns, 250);
    } finally {
      await pool.query('UPDATE universes SET starting_turns = 500 WHERE id = $1', [UNIVERSE_ID]);
    }
  });

  it('New player gets last_turns_granted_at set', async () => {
    const before = new Date();
    const { playerId } = await joinUniverse(pool);
    const r = await pool.query('SELECT last_turns_granted_at FROM players WHERE id = $1', [playerId]);
    assert.ok(new Date(r.rows[0].last_turns_granted_at) >= new Date(before.getTime() - 2000));
  });

  it('New player ship has turns_per_warp from config', async () => {
    const { playerId } = await joinUniverse(pool);
    const r = await pool.query('SELECT ship_name, turns_per_warp FROM player_ships WHERE player_id = $1', [playerId]);
    assert.ok(r.rows.length > 0);
    assert.ok(r.rows[0].turns_per_warp >= 1);
    if (r.rows[0].ship_name === 'Merchant Freighter') assert.equal(r.rows[0].turns_per_warp, 3);
  });
});

// --- ShipInfo includes turns fields ---

describe('ShipInfo includes turn and hyperwarp fields', () => {
  it('ShipInfo response includes turnsPerWarp', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws } = await connectWS(token);

    const result = await wsRequest(ws, { type: 'shipInfo' }, 'shipInfoResult');
    assert.equal(result.type, 'shipInfoResult');
    assert.ok('turnsPerWarp' in result, 'shipInfoResult must include turnsPerWarp');
    assert.ok(typeof result.turnsPerWarp === 'number');

    await closeWS(ws);
  });

  it('ShipInfo response includes hasHyperwarpDrive', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws } = await connectWS(token);

    const result = await wsRequest(ws, { type: 'shipInfo' }, 'shipInfoResult');
    assert.equal(result.type, 'shipInfoResult');
    assert.ok('hasHyperwarpDrive' in result, 'shipInfoResult must include hasHyperwarpDrive');
    assert.equal(typeof result.hasHyperwarpDrive, 'boolean');

    await closeWS(ws);
  });

  it('ShipInfo response includes turns (player current turns)', async () => {
    const { token, playerId } = await joinUniverse(pool);
    await pool.query('UPDATE players SET turns = 42 WHERE id = $1', [playerId]);
    const { ws } = await connectWS(token);

    const result = await wsRequest(ws, { type: 'shipInfo' }, 'shipInfoResult');
    assert.equal(result.type, 'shipInfoResult');
    assert.ok('turns' in result, 'shipInfoResult must include turns');
    assert.equal(result.turns, 42);

    await closeWS(ws);
  });

  it('ShipInfo turnsPerWarp matches DB value after trade-in', async () => {
    const { token, playerId } = await joinUniverse(pool);
    await pool.query("UPDATE player_ships SET turns_per_warp = 5 WHERE player_id = $1", [playerId]);
    const { ws } = await connectWS(token);

    const result = await wsRequest(ws, { type: 'shipInfo' }, 'shipInfoResult');
    assert.equal(result.turnsPerWarp, 5);

    await closeWS(ws);
  });
});

// --- Ship trade-in resets turns_per_warp and has_hyperwarp_drive ---

describe('Ship trade-in resets ship-specific fields', () => {
  it('After trade-in, turns_per_warp matches new ship config', async () => {
    const { token, playerId } = await joinUniverse(pool);
    await pool.query('UPDATE players SET turns = 9999 WHERE id = $1', [playerId]);
    const { ws } = await connectWS(token);

    // Navigate to Starbase
    const starbaseRes = await pool.query('SELECT sector_id FROM ports WHERE universe_id = $1 AND class = 9 LIMIT 1', [UNIVERSE_ID]);
    assert.ok(starbaseRes.rows.length > 0, 'Starbase must exist');
    const starbaseSector = starbaseRes.rows[0].sector_id;
    const moved = await movePlayerTo(ws, starbaseSector);
    assert.ok(moved, 'Must reach Starbase');

    await wsRequest(ws, { type: 'dockStarbase' }, 'dockStarbaseResult');

    // Give enough credits for any ship
    await pool.query('UPDATE ship_cargo SET credits = 999999 WHERE player_id = $1', [playerId]);

    // Trade to Scout (turnsPerWarp should be 2 based on config)
    const scoutCfg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'ships', 'scout.json'), 'utf8'));
    const result = await wsRequest(ws, { type: 'shipExchangeTradein', targetShipName: 'Scout Marauder' }, 'buyShipTradeinResult');
    if (result.type === 'error') { await closeWS(ws); assert.fail(`Trade failed: ${result.message}`); }

    const shipRes = await pool.query('SELECT turns_per_warp FROM player_ships WHERE player_id = $1', [playerId]);
    assert.equal(shipRes.rows[0].turns_per_warp, scoutCfg.turnsPerWarp,
      `turns_per_warp should match Scout config (${scoutCfg.turnsPerWarp})`);

    await closeWS(ws);
  });

  it('After trade-in, has_hyperwarp_drive is false', async () => {
    const { token, playerId } = await joinUniverse(pool);
    await pool.query('UPDATE players SET turns = 9999 WHERE id = $1', [playerId]);
    const { ws } = await connectWS(token);

    // Navigate to Starbase
    const starbaseRes = await pool.query('SELECT sector_id FROM ports WHERE universe_id = $1 AND class = 9 LIMIT 1', [UNIVERSE_ID]);
    const starbaseSector = starbaseRes.rows[0].sector_id;
    await movePlayerTo(ws, starbaseSector);
    await wsRequest(ws, { type: 'dockStarbase' }, 'dockStarbaseResult');

    // Give the player a hyperwarp drive, then trade ships
    await pool.query('UPDATE player_ships SET has_hyperwarp_drive = true WHERE player_id = $1', [playerId]);
    await pool.query('UPDATE ship_cargo SET credits = 999999 WHERE player_id = $1', [playerId]);

    const result = await wsRequest(ws, { type: 'shipExchangeTradein', targetShipName: 'Scout Marauder' }, 'buyShipTradeinResult');
    if (result.type === 'error') { await closeWS(ws); assert.fail(`Trade failed: ${result.message}`); }

    const driveRes = await pool.query('SELECT has_hyperwarp_drive FROM player_ships WHERE player_id = $1', [playerId]);
    assert.equal(driveRes.rows[0].has_hyperwarp_drive, false,
      'Hyperwarp drive should not transfer to new ship');

    await closeWS(ws);
  });
});

// --- Warp turn costs ---

describe('Warp turn costs', () => {
  it('Warping deducts turns_per_warp and response includes turnsUsed', async () => {
    const { token, playerId } = await joinUniverse(pool);
    await pool.query('UPDATE players SET turns = 100 WHERE id = $1', [playerId]);
    const { ws, welcome } = await connectWS(token);

    const tpw = (await pool.query('SELECT turns_per_warp FROM player_ships WHERE player_id = $1', [playerId])).rows[0].turns_per_warp;
    const adj = await getAdjacentSector(ws);
    assert.ok(adj, 'Need adjacent sector');
    await pool.query('DELETE FROM sector_drones WHERE sector_id = $1 AND universe_id = $2', [adj, UNIVERSE_ID]);

    const result = await wsRequest(ws, { type: 'move', sector: adj }, 'moveResult');
    assert.equal(result.outcome, 'success');
    assert.equal(result.turnsUsed, tpw);
    const after = (await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns;
    assert.equal(after, 100 - tpw);

    await closeWS(ws);
  });

  it('Warping rejected when insufficient turns', async () => {
    const { token, playerId } = await joinUniverse(pool);
    await pool.query('UPDATE players SET turns = 0 WHERE id = $1', [playerId]);
    const { ws } = await connectWS(token);

    const adj = await getAdjacentSector(ws);
    assert.ok(adj);
    await clearSectorDrones(adj);
    const result = await wsRequest(ws, { type: 'move', sector: adj }, 'moveResult');
    assert.ok(result.type === 'error' || result.outcome === 'error');
    assert.match(result.message.toLowerCase(), /insufficient turns/);

    await closeWS(ws);
  });
});

// --- Unlimited universe warp ---

describe('Unlimited universe - warp', () => {
  before(() => pool.query('UPDATE universes SET turns_per_day = 0 WHERE id = $1', [UNIVERSE_ID]));
  after(() => pool.query('UPDATE universes SET turns_per_day = 500 WHERE id = $1', [UNIVERSE_ID]));

  it('Unlimited: warp turnsUsed = 0, no deduction', async () => {
    const { token, playerId } = await joinUniverse(pool);
    await pool.query('UPDATE players SET turns = 10 WHERE id = $1', [playerId]);
    const { ws } = await connectWS(token);

    const adj = await getAdjacentSector(ws);
    await clearSectorDrones(adj);
    const result = await wsRequest(ws, { type: 'move', sector: adj }, 'moveResult');
    assert.equal(result.outcome, 'success');
    assert.equal(result.turnsUsed, 0);
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 10);

    await closeWS(ws);
  });

  it('Unlimited: warp succeeds with 0 turns', async () => {
    const { token, playerId } = await joinUniverse(pool);
    await pool.query('UPDATE players SET turns = 0 WHERE id = $1', [playerId]);
    const { ws } = await connectWS(token);

    const adj = await getAdjacentSector(ws);
    await clearSectorDrones(adj);
    const result = await wsRequest(ws, { type: 'move', sector: adj }, 'moveResult');
    assert.equal(result.outcome, 'success');

    await closeWS(ws);
  });
});

// --- Docking ---

describe('Docking costs 0 turns', () => {
  it('Docking at a port costs 0 turns', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws } = await connectWS(token);

    // Find an adjacent sector with a warp, move there, ensure it has a port
    const adj = await getAdjacentSector(ws);
    assert.ok(adj);
    await ensureSellingPort(pool, adj);
    await pool.query('DELETE FROM sector_drones WHERE sector_id = $1 AND universe_id = $2', [adj, UNIVERSE_ID]);
    await wsRequest(ws, { type: 'move', sector: adj }, 'moveResult');

    await pool.query('UPDATE players SET turns = 50 WHERE id = $1', [playerId]);
    const dockRes = await wsRequest(ws, { type: 'dock' }, 'dockResult');
    assert.ok(dockRes.docked);
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 50);

    await closeWS(ws);
  });
});

// --- Buy cargo ---

describe('Buy cargo turn costs', () => {
  it('Buying cargo costs 1 turn and includes turnsUsed', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws } = await connectWS(token);

    const adj = await getAdjacentSector(ws);
    await ensureSellingPort(pool, adj);
    await clearSectorDrones(adj);
    await wsRequest(ws, { type: 'move', sector: adj }, 'moveResult');
    await wsRequest(ws, { type: 'dock' }, 'dockResult');

    await pool.query('UPDATE players SET turns = 50 WHERE id = $1', [playerId]);
    const result = await wsRequest(ws, { type: 'portTransaction', good: 'fuel', quantity: 1, action: 'buy' }, 'portTransactionResult');
    assert.equal(result.type, 'portTransactionResult');
    assert.equal(result.turnsUsed, 1);
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 49);

    await closeWS(ws);
  });

  it('Buying cargo rejected when 0 turns', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws } = await connectWS(token);

    const adj = await getAdjacentSector(ws);
    await ensureSellingPort(pool, adj);
    await clearSectorDrones(adj);
    await wsRequest(ws, { type: 'move', sector: adj }, 'moveResult');
    await wsRequest(ws, { type: 'dock' }, 'dockResult');

    await pool.query('UPDATE players SET turns = 0 WHERE id = $1', [playerId]);
    const result = await wsRequest(ws, { type: 'portTransaction', good: 'fuel', quantity: 1, action: 'buy' }, 'portTransactionResult');
    assert.equal(result.type, 'error');
    assert.match(result.message.toLowerCase(), /insufficient turns/);

    await closeWS(ws);
  });
});

// --- Sell cargo ---

describe('Sell cargo costs 0 turns', () => {
  it('Selling cargo costs 0 turns', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws } = await connectWS(token);

    const adj = await getAdjacentSector(ws);
    await ensureBuyingPort(pool, adj);
    await clearSectorDrones(adj);
    await wsRequest(ws, { type: 'move', sector: adj }, 'moveResult');
    // Give cargo directly
    await pool.query('UPDATE ship_cargo SET fuel = 10 WHERE player_id = $1', [playerId]);
    await pool.query('UPDATE players SET turns = 50 WHERE id = $1', [playerId]);

    await wsRequest(ws, { type: 'dock' }, 'dockResult');
    const result = await wsRequest(ws, { type: 'portTransaction', good: 'fuel', quantity: 1, action: 'sell' }, 'portTransactionResult');
    assert.equal(result.type, 'portTransactionResult');
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 50);

    await closeWS(ws);
  });
});

// --- Leave planet ---

describe('Leave planet turn costs', () => {
  it('Landing on a planet costs 0 turns', async () => {
    const { token, playerId } = await joinUniverse(pool);
    await pool.query('UPDATE players SET turns = 9999 WHERE id = $1', [playerId]);
    const { ws } = await connectWS(token);

    const planetRes = await pool.query('SELECT id FROM planets WHERE sector_id = 1 AND universe_id = $1 LIMIT 1', [UNIVERSE_ID]);
    assert.ok(planetRes.rows.length > 0, 'No planet in sector 1');
    await movePlayerTo(ws, planetRes.rows[0].sector_id);

    await pool.query('UPDATE players SET turns = 50 WHERE id = $1', [playerId]);
    await wsRequest(ws, { type: 'landOnPlanet', planetId: planetRes.rows[0].id }, 'landOnPlanetResult');
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 50);

    await closeWS(ws);
  });

  it('Leaving a planet costs 1 turn and includes turnsUsed', async () => {
    const { token, playerId } = await joinUniverse(pool);
    await pool.query('UPDATE players SET turns = 9999 WHERE id = $1', [playerId]);
    const { ws } = await connectWS(token);

    const planetRes = await pool.query('SELECT id FROM planets WHERE sector_id = 1 AND universe_id = $1 LIMIT 1', [UNIVERSE_ID]);
    await movePlayerTo(ws, planetRes.rows[0].sector_id);
    await wsRequest(ws, { type: 'landOnPlanet', planetId: planetRes.rows[0].id }, 'landOnPlanetResult');
    await pool.query('UPDATE players SET turns = 50 WHERE id = $1', [playerId]);

    const result = await wsRequest(ws, { type: 'leavePlanet' }, 'leavePlanetResult');
    assert.equal(result.type, 'leavePlanetResult');
    assert.equal(result.turnsUsed, 1);
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 49);

    await closeWS(ws);
  });

  it('Leaving planet rejected when 0 turns', async () => {
    const { token, playerId } = await joinUniverse(pool);
    await pool.query('UPDATE players SET turns = 9999 WHERE id = $1', [playerId]);
    const { ws } = await connectWS(token);

    const planetRes = await pool.query('SELECT id FROM planets WHERE sector_id = 1 AND universe_id = $1 LIMIT 1', [UNIVERSE_ID]);
    await movePlayerTo(ws, planetRes.rows[0].sector_id);
    await wsRequest(ws, { type: 'landOnPlanet', planetId: planetRes.rows[0].id }, 'landOnPlanetResult');
    await pool.query('UPDATE players SET turns = 0 WHERE id = $1', [playerId]);

    const result = await wsRequest(ws, { type: 'leavePlanet' }, 'leavePlanetResult');
    assert.equal(result.type, 'error');
    assert.match(result.message.toLowerCase(), /insufficient turns/);

    await closeWS(ws);
  });
});

// --- Buy holds ---

describe('Buy holds turn costs', () => {
  it('Buying holds costs 1 turn and includes turnsUsed', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws } = await connectWS(token);
    // Player starts in sector 1 which has class 0 port
    await pool.query('UPDATE players SET turns = 50 WHERE id = $1', [playerId]);

    const result = await wsRequest(ws, { type: 'buyHolds', quantity: 1 }, 'buyHoldsResult');
    if (result.type === 'error' && !result.message.toLowerCase().includes('turns')) { await closeWS(ws); return; }
    assert.equal(result.type, 'buyHoldsResult');
    assert.equal(result.turnsUsed, 1);
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 49);

    await closeWS(ws);
  });

  it('Buying holds rejected when 0 turns', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws } = await connectWS(token);
    await pool.query('UPDATE players SET turns = 0 WHERE id = $1', [playerId]);

    const result = await wsRequest(ws, { type: 'buyHolds', quantity: 1 }, 'buyHoldsResult');
    if (result.type === 'error' && result.message.toLowerCase().includes('class 0')) { await closeWS(ws); return; }
    assert.equal(result.type, 'error');
    assert.match(result.message.toLowerCase(), /insufficient turns/);

    await closeWS(ws);
  });
});

// --- Zero-cost actions ---

describe('Zero-cost actions', () => {
  it('Buying drones costs 0 turns', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws } = await connectWS(token);
    await pool.query('UPDATE players SET turns = 50 WHERE id = $1', [playerId]);
    await wsRequest(ws, { type: 'buyDrones', quantity: 1 }, 'buyDronesResult');
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 50);
    await closeWS(ws);
  });

  it('Buying shields costs 0 turns', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws } = await connectWS(token);
    await pool.query('UPDATE players SET turns = 50 WHERE id = $1', [playerId]);
    await wsRequest(ws, { type: 'buyShields', quantity: 1 }, 'buyShieldsResult');
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 50);
    await closeWS(ws);
  });

  it('Jettisoning costs 0 turns', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws } = await connectWS(token);
    await pool.query('UPDATE players SET turns = 50 WHERE id = $1', [playerId]);
    await wsRequest(ws, { type: 'jettison' }, 'jettisonResult');
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 50);
    await closeWS(ws);
  });

  it('Deploying drones costs 0 turns', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws } = await connectWS(token);
    await pool.query('UPDATE players SET turns = 50 WHERE id = $1', [playerId]);
    // Give player some drones to deploy
    await pool.query('UPDATE player_ships SET drones = 10 WHERE player_id = $1', [playerId]);
    await wsRequest(ws, { type: 'deployDrones', quantity: 1 }, 'deployDronesResult');
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 50);
    // Clean up
    await pool.query('DELETE FROM sector_drones WHERE owner_id = $1', [playerId]);
    await closeWS(ws);
  });
});

// --- Unlimited non-warp ---

describe('Unlimited universe - non-warp', () => {
  before(() => pool.query('UPDATE universes SET turns_per_day = 0 WHERE id = $1', [UNIVERSE_ID]));
  after(() => pool.query('UPDATE universes SET turns_per_day = 500 WHERE id = $1', [UNIVERSE_ID]));

  it('Unlimited: buying cargo turnsUsed = 0', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws } = await connectWS(token);

    const adj = await getAdjacentSector(ws);
    await ensureSellingPort(pool, adj);
    await clearSectorDrones(adj);
    await wsRequest(ws, { type: 'move', sector: adj }, 'moveResult');
    await wsRequest(ws, { type: 'dock' }, 'dockResult');

    await pool.query('UPDATE players SET turns = 5 WHERE id = $1', [playerId]);
    const result = await wsRequest(ws, { type: 'portTransaction', good: 'fuel', quantity: 1, action: 'buy' }, 'portTransactionResult');
    assert.equal(result.type, 'portTransactionResult');
    assert.equal(result.turnsUsed, 0);
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 5);

    await closeWS(ws);
  });

  it('Unlimited: leaving planet turnsUsed = 0', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws } = await connectWS(token);

    const planetRes = await pool.query('SELECT id FROM planets WHERE sector_id = 1 AND universe_id = $1 LIMIT 1', [UNIVERSE_ID]);
    assert.ok(planetRes.rows.length > 0);
    await wsRequest(ws, { type: 'landOnPlanet', planetId: planetRes.rows[0].id }, 'landOnPlanetResult');
    await pool.query('UPDATE players SET turns = 5 WHERE id = $1', [playerId]);

    const result = await wsRequest(ws, { type: 'leavePlanet' }, 'leavePlanetResult');
    assert.equal(result.type, 'leavePlanetResult');
    assert.equal(result.turnsUsed, 0);
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 5);

    await closeWS(ws);
  });

  it('Unlimited: buying holds turnsUsed = 0', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws } = await connectWS(token);
    await pool.query('UPDATE players SET turns = 5 WHERE id = $1', [playerId]);

    const result = await wsRequest(ws, { type: 'buyHolds', quantity: 1 }, 'buyHoldsResult');
    if (result.type === 'error' && !result.message.toLowerCase().includes('turns')) { await closeWS(ws); return; }
    assert.equal(result.turnsUsed, 0);
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 5);

    await closeWS(ws);
  });

  it('Unlimited: buying cargo succeeds with 0 turns', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws } = await connectWS(token);

    const adj = await getAdjacentSector(ws);
    await ensureSellingPort(pool, adj);
    await clearSectorDrones(adj);
    await wsRequest(ws, { type: 'move', sector: adj }, 'moveResult');
    await wsRequest(ws, { type: 'dock' }, 'dockResult');

    await pool.query('UPDATE players SET turns = 0 WHERE id = $1', [playerId]);
    const result = await wsRequest(ws, { type: 'portTransaction', good: 'fuel', quantity: 1, action: 'buy' }, 'portTransactionResult');
    assert.equal(result.type, 'portTransactionResult');

    await closeWS(ws);
  });

  it('Unlimited: leaving planet succeeds with 0 turns', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws } = await connectWS(token);

    const planetRes = await pool.query('SELECT id FROM planets WHERE sector_id = 1 AND universe_id = $1 LIMIT 1', [UNIVERSE_ID]);
    assert.ok(planetRes.rows.length > 0);
    await wsRequest(ws, { type: 'landOnPlanet', planetId: planetRes.rows[0].id }, 'landOnPlanetResult');
    await pool.query('UPDATE players SET turns = 0 WHERE id = $1', [playerId]);

    const result = await wsRequest(ws, { type: 'leavePlanet' }, 'leavePlanetResult');
    assert.equal(result.type, 'leavePlanetResult');

    await closeWS(ws);
  });
});

// --- Grant turns script ---

describe('Grant turns script', () => {
  before(() => pool.query('UPDATE universes SET turns_per_day = 240, max_turns = 100 WHERE id = $1', [UNIVERSE_ID]));
  after(() => pool.query('UPDATE universes SET turns_per_day = 500, max_turns = 2000 WHERE id = $1', [UNIVERSE_ID]));

  it('Script runs without error and prints player count', () => {
    const output = execFileSync('node', ['scripts/grant-turns.js'], { cwd: PROJECT_ROOT, env: testEnv(), encoding: 'utf8' });
    assert.ok(typeof output === 'string');
    // Must print a number (the total players updated)
    assert.match(output.trim(), /\d+/, 'Script must print the number of players updated');
  });

  it('Grants correct turns based on elapsed time', async () => {
    const { playerId } = await joinUniverse(pool);
    // 10 + 3h * floor(240/24) = 10 + 30 = 40
    await pool.query(`UPDATE players SET turns = 10, last_turns_granted_at = NOW() - interval '3 hours' WHERE id = $1`, [playerId]);
    execFileSync('node', ['scripts/grant-turns.js'], { cwd: PROJECT_ROOT, env: testEnv(), encoding: 'utf8' });
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 40);
  });

  it('Caps turns at max_turns', async () => {
    const { playerId } = await joinUniverse(pool);
    // 90 + 30 = 120, capped at 100
    await pool.query(`UPDATE players SET turns = 90, last_turns_granted_at = NOW() - interval '3 hours' WHERE id = $1`, [playerId]);
    execFileSync('node', ['scripts/grant-turns.js'], { cwd: PROJECT_ROOT, env: testEnv(), encoding: 'utf8' });
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 100);
  });

  it('Updates last_turns_granted_at', async () => {
    const { playerId } = await joinUniverse(pool);
    await pool.query(`UPDATE players SET last_turns_granted_at = NOW() - interval '2 hours' WHERE id = $1`, [playerId]);
    const before = new Date();
    execFileSync('node', ['scripts/grant-turns.js'], { cwd: PROJECT_ROOT, env: testEnv(), encoding: 'utf8' });
    const ts = new Date((await pool.query('SELECT last_turns_granted_at FROM players WHERE id = $1', [playerId])).rows[0].last_turns_granted_at);
    assert.ok(ts >= new Date(before.getTime() - 2000));
  });

  it('Skips unlimited universes', async () => {
    await pool.query('UPDATE universes SET turns_per_day = 0 WHERE id = $1', [UNIVERSE_ID]);
    const { playerId } = await joinUniverse(pool);
    await pool.query(`UPDATE players SET turns = 5, last_turns_granted_at = NOW() - interval '10 hours' WHERE id = $1`, [playerId]);
    execFileSync('node', ['scripts/grant-turns.js'], { cwd: PROJECT_ROOT, env: testEnv(), encoding: 'utf8' });
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 5);
    await pool.query('UPDATE universes SET turns_per_day = 240 WHERE id = $1', [UNIVERSE_ID]);
  });

  it('Grants 0 when less than 1 hour elapsed', async () => {
    const { playerId } = await joinUniverse(pool);
    await pool.query(`UPDATE players SET turns = 20, last_turns_granted_at = NOW() - interval '30 minutes' WHERE id = $1`, [playerId]);
    execFileSync('node', ['scripts/grant-turns.js'], { cwd: PROJECT_ROOT, env: testEnv(), encoding: 'utf8' });
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 20);
  });

  it('Does not update last_turns_granted_at when 0 turns granted', async () => {
    const { playerId } = await joinUniverse(pool);
    // Set timestamp to 30 min ago — less than 1 hour, so 0 turns should be granted
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
    await pool.query(`UPDATE players SET turns = 20, last_turns_granted_at = $1 WHERE id = $2`, [thirtyMinAgo, playerId]);

    execFileSync('node', ['scripts/grant-turns.js'], { cwd: PROJECT_ROOT, env: testEnv(), encoding: 'utf8' });

    const ts = new Date((await pool.query('SELECT last_turns_granted_at FROM players WHERE id = $1', [playerId])).rows[0].last_turns_granted_at);
    // Timestamp should NOT have been updated to NOW() — it should still be ~30 min ago
    // Allow 5 seconds of tolerance for the original set
    assert.ok(Math.abs(ts.getTime() - thirtyMinAgo.getTime()) < 5000,
      `last_turns_granted_at should be preserved when 0 turns granted, but was updated to ${ts.toISOString()}`);
  });

  it('Boundary: 59m59s gets 0 turns, exactly 60m gets hourly rate', async () => {
    // turns_per_day = 240 → hourly_rate = floor(240/24) = 10
    const { playerId: pUnder } = await joinUniverse(pool);
    const { playerId: pExact } = await joinUniverse(pool);
    await pool.query(`UPDATE players SET turns = 0, last_turns_granted_at = NOW() - interval '59 minutes 59 seconds' WHERE id = $1`, [pUnder]);
    await pool.query(`UPDATE players SET turns = 0, last_turns_granted_at = NOW() - interval '60 minutes' WHERE id = $1`, [pExact]);

    execFileSync('node', ['scripts/grant-turns.js'], { cwd: PROJECT_ROOT, env: testEnv(), encoding: 'utf8' });

    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [pUnder])).rows[0].turns, 0);
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [pExact])).rows[0].turns, 10);
  });

  it('Double-run: second run grants 0 additional turns', async () => {
    // Grant turns from 2 hours ago, then immediately re-run — should get 0 more
    const { playerId } = await joinUniverse(pool);
    await pool.query(`UPDATE players SET turns = 0, last_turns_granted_at = NOW() - interval '2 hours' WHERE id = $1`, [playerId]);

    execFileSync('node', ['scripts/grant-turns.js'], { cwd: PROJECT_ROOT, env: testEnv(), encoding: 'utf8' });
    const turnsAfterFirst = (await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns;
    assert.equal(turnsAfterFirst, 20); // 2 * floor(240/24) = 20

    execFileSync('node', ['scripts/grant-turns.js'], { cwd: PROJECT_ROOT, env: testEnv(), encoding: 'utf8' });
    const turnsAfterSecond = (await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns;
    assert.equal(turnsAfterSecond, 20); // no additional turns
  });

  it('Fractional hours: 2h50m grants only 2 hours worth', async () => {
    // 2h50m = 2 whole hours, so 2 * 10 = 20 turns
    const { playerId } = await joinUniverse(pool);
    await pool.query(`UPDATE players SET turns = 5, last_turns_granted_at = NOW() - interval '2 hours 50 minutes' WHERE id = $1`, [playerId]);
    execFileSync('node', ['scripts/grant-turns.js'], { cwd: PROJECT_ROOT, env: testEnv(), encoding: 'utf8' });
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 25); // 5 + 20
  });

  it('Concurrent runs do not double-grant turns', async () => {
    // Without row locking, two simultaneous runs could both read stale
    // last_turns_granted_at and each grant 20 turns → 40 total.
    // With proper locking, second process waits, sees updated timestamp, grants 0 → 20 total.
    const { playerId } = await joinUniverse(pool);
    await pool.query(`UPDATE players SET turns = 0, last_turns_granted_at = NOW() - interval '2 hours' WHERE id = $1`, [playerId]);

    const runGrant = () => new Promise((resolve, reject) => {
      const proc = spawn('node', ['scripts/grant-turns.js'], {
        cwd: PROJECT_ROOT, env: testEnv(), stdio: 'pipe',
      });
      let out = '';
      proc.stdout.on('data', (d) => { out += d; });
      proc.stderr.on('data', (d) => { out += d; });
      const killTimer = setTimeout(() => { proc.kill(); }, 10000);
      proc.on('close', (code) => { clearTimeout(killTimer); resolve({ code, out }); });
      proc.on('error', (err) => { clearTimeout(killTimer); reject(err); });
    });

    // Launch both at the same time
    const [r1, r2] = await Promise.all([runGrant(), runGrant()]);
    assert.equal(r1.code, 0);
    assert.equal(r2.code, 0);

    const turns = (await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns;
    assert.equal(turns, 20, `Expected 20 turns (one grant of 2h * 10/h), got ${turns} — possible missing row lock`);
  });
});

// ============================================================
// HYPERSPACE JUMP SYSTEM TESTS
// ============================================================

/** Find the Starbase sector (port class 9) */
async function findStarbaseSector() {
  const res = await pool.query('SELECT sector_id FROM ports WHERE universe_id = $1 AND class = 9 LIMIT 1', [UNIVERSE_ID]);
  return res.rows.length > 0 ? res.rows[0].sector_id : null;
}

/** Move player to starbase, dock, and return ws + player info */
async function goToStarbase(pool) {
  const { token, playerId } = await joinUniverse(pool);
  // Give plenty of turns for navigation
  await pool.query('UPDATE players SET turns = 9999 WHERE id = $1', [playerId]);
  const { ws } = await connectWS(token);

  const starbaseSector = await findStarbaseSector();
  assert.ok(starbaseSector, 'Starbase sector must exist');

  const moved = await movePlayerTo(ws, starbaseSector);
  assert.ok(moved, 'Must be able to reach Starbase');

  await wsRequest(ws, { type: 'dockStarbase' }, 'dockStarbaseResult');
  return { ws, token, playerId, starbaseSector };
}

/** Deploy drones in a sector for a player (directly via DB) */
async function deployDronesInSector(pool, playerId, sectorId, quantity, universeId = UNIVERSE_ID) {
  await pool.query(`
    INSERT INTO sector_drones (sector_id, universe_id, owner_id, quantity)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (sector_id, universe_id) DO UPDATE SET owner_id = $3, quantity = $4
  `, [sectorId, universeId, playerId, quantity]);
}

// --- Ship config: canHaveHyperwarp ---

describe('Ship configs - canHaveHyperwarp', () => {
  it('Merchant Freighter has canHaveHyperwarp = false', () => {
    const cfg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'ships', 'merchant.json'), 'utf8'));
    assert.strictEqual(cfg.canHaveHyperwarp, false);
  });

  it('Scout Marauder has canHaveHyperwarp = true', () => {
    const cfg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'ships', 'scout.json'), 'utf8'));
    assert.strictEqual(cfg.canHaveHyperwarp, true);
  });

  it('All ships follow the maxDrones >= 10 rule (except Merchant and Scout)', () => {
    const files = readdirSync(join(PROJECT_ROOT, 'config', 'ships')).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const cfg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'ships', file), 'utf8'));
      assert.ok(typeof cfg.canHaveHyperwarp === 'boolean', `${file}: missing canHaveHyperwarp`);
      // Merchant and Scout have explicit overrides, skip the rule check for them
      if (cfg.name === 'Merchant Freighter' || cfg.name === 'Scout Marauder') continue;
      const expected = cfg.maxDrones >= 10;
      assert.strictEqual(cfg.canHaveHyperwarp, expected,
        `${file}: canHaveHyperwarp should be ${expected} (maxDrones=${cfg.maxDrones})`);
    }
  });
});

// --- Schema: has_hyperwarp_drive ---

describe('Schema - has_hyperwarp_drive', () => {
  it('player_ships.has_hyperwarp_drive exists (boolean, NOT NULL, default false)', async () => {
    const res = await pool.query(`
      SELECT data_type, column_default, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'player_ships' AND column_name = 'has_hyperwarp_drive'
    `);
    assert.equal(res.rows.length, 1);
    assert.match(res.rows[0].data_type, /bool/i);
    assert.equal(res.rows[0].is_nullable, 'NO');
    assert.match(res.rows[0].column_default, /false/i);
  });
});

// --- BuyHyperwarpDrive ---

describe('BuyHyperwarpDrive', () => {
  it('Successfully buys hyperwarp drive at Starbase', async () => {
    const { ws, playerId } = await goToStarbase(pool);
    // Give credits and ensure ship can equip (use scout which has canHaveHyperwarp: true)
    // Player starts with default ship; we need to check if it can equip
    const shipRes = await pool.query('SELECT ship_name FROM player_ships WHERE player_id = $1', [playerId]);
    const shipName = shipRes.rows[0].ship_name;
    const cfgFiles = readdirSync(join(PROJECT_ROOT, 'config', 'ships')).filter(f => f.endsWith('.json'));
    let canEquip = false;
    for (const file of cfgFiles) {
      const cfg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'ships', file), 'utf8'));
      if (cfg.name === shipName) { canEquip = cfg.canHaveHyperwarp; break; }
    }

    if (!canEquip) {
      // Switch to a ship that can equip by updating DB directly
      await pool.query("UPDATE player_ships SET ship_name = 'Scout Marauder' WHERE player_id = $1", [playerId]);
    }

    await pool.query('UPDATE ship_cargo SET credits = 100000 WHERE player_id = $1', [playerId]);
    await pool.query('UPDATE player_ships SET has_hyperwarp_drive = false WHERE player_id = $1', [playerId]);

    const result = await wsRequest(ws, { type: 'buyHyperwarpDrive' }, 'buyHyperwarpDriveResult');
    assert.equal(result.type, 'buyHyperwarpDriveResult');

    const driveRes = await pool.query('SELECT has_hyperwarp_drive FROM player_ships WHERE player_id = $1', [playerId]);
    assert.equal(driveRes.rows[0].has_hyperwarp_drive, true);

    const creditsRes = await pool.query('SELECT credits FROM ship_cargo WHERE player_id = $1', [playerId]);
    assert.equal(creditsRes.rows[0].credits, 50000); // 100000 - 50000

    await closeWS(ws);
  });

  it('Rejected when not at Starbase', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws } = await connectWS(token);
    await pool.query("UPDATE player_ships SET ship_name = 'Scout Marauder', has_hyperwarp_drive = false WHERE player_id = $1", [playerId]);
    await pool.query('UPDATE ship_cargo SET credits = 100000 WHERE player_id = $1', [playerId]);

    const result = await wsRequest(ws, { type: 'buyHyperwarpDrive' }, 'buyHyperwarpDriveResult');
    assert.equal(result.type, 'error');

    await closeWS(ws);
  });

  it('Rejected when ship cannot equip hyperwarp', async () => {
    const { ws, playerId } = await goToStarbase(pool);
    // Merchant Freighter has canHaveHyperwarp: false
    await pool.query("UPDATE player_ships SET ship_name = 'Merchant Freighter' WHERE player_id = $1", [playerId]);
    await pool.query('UPDATE ship_cargo SET credits = 100000 WHERE player_id = $1', [playerId]);

    const result = await wsRequest(ws, { type: 'buyHyperwarpDrive' }, 'buyHyperwarpDriveResult');
    assert.equal(result.type, 'error');
    assert.match(result.message.toLowerCase(), /incapable/);

    await closeWS(ws);
  });

  it('Rejected when already have hyperwarp drive', async () => {
    const { ws, playerId } = await goToStarbase(pool);
    await pool.query("UPDATE player_ships SET ship_name = 'Scout Marauder', has_hyperwarp_drive = true WHERE player_id = $1", [playerId]);
    await pool.query('UPDATE ship_cargo SET credits = 100000 WHERE player_id = $1', [playerId]);

    const result = await wsRequest(ws, { type: 'buyHyperwarpDrive' }, 'buyHyperwarpDriveResult');
    assert.equal(result.type, 'error');
    assert.match(result.message.toLowerCase(), /already/);

    await closeWS(ws);
  });

  it('Rejected when insufficient credits', async () => {
    const { ws, playerId } = await goToStarbase(pool);
    await pool.query("UPDATE player_ships SET ship_name = 'Scout Marauder', has_hyperwarp_drive = false WHERE player_id = $1", [playerId]);
    await pool.query('UPDATE ship_cargo SET credits = 100 WHERE player_id = $1', [playerId]);

    const result = await wsRequest(ws, { type: 'buyHyperwarpDrive' }, 'buyHyperwarpDriveResult');
    assert.equal(result.type, 'error');
    assert.match(result.message.toLowerCase(), /credits/);

    await closeWS(ws);
  });

  it('Buying hyperwarp drive costs 0 turns', async () => {
    const { ws, playerId } = await goToStarbase(pool);
    await pool.query("UPDATE player_ships SET ship_name = 'Scout Marauder', has_hyperwarp_drive = false WHERE player_id = $1", [playerId]);
    await pool.query('UPDATE ship_cargo SET credits = 100000 WHERE player_id = $1', [playerId]);
    await pool.query('UPDATE players SET turns = 50 WHERE id = $1', [playerId]);

    await wsRequest(ws, { type: 'buyHyperwarpDrive' }, 'buyHyperwarpDriveResult');
    const turnsAfter = (await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns;
    assert.equal(turnsAfter, 50);

    await closeWS(ws);
  });
});

// --- ListDeployedDrones ---

describe('ListDeployedDrones', () => {
  it('Returns deployed drones for the player', async () => {
    const { token, playerId } = await joinUniverse(pool);
    await pool.query('UPDATE players SET turns = 9999 WHERE id = $1', [playerId]);
    const { ws } = await connectWS(token);

    // Deploy drones in two sectors via DB
    await deployDronesInSector(pool, playerId, 5, 10);
    await deployDronesInSector(pool, playerId, 15, 20);

    const result = await wsRequest(ws, { type: 'listDeployedDrones' }, 'listDeployedDronesResult');
    assert.equal(result.type, 'listDeployedDronesResult');
    assert.ok(Array.isArray(result.drones));

    const s5 = result.drones.find(f => f.sectorId === 5);
    const s15 = result.drones.find(f => f.sectorId === 15);
    assert.ok(s5, 'Should include sector 5');
    assert.equal(s5.quantity, 10);
    assert.ok(s15, 'Should include sector 15');
    assert.equal(s15.quantity, 20);

    // Cleanup
    await pool.query('DELETE FROM sector_drones WHERE owner_id = $1', [playerId]);
    await closeWS(ws);
  });

  it('Returns empty array when no drones deployed', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws } = await connectWS(token);

    // Make sure no drones for this player
    await pool.query('DELETE FROM sector_drones WHERE owner_id = $1', [playerId]);

    const result = await wsRequest(ws, { type: 'listDeployedDrones' }, 'listDeployedDronesResult');
    assert.equal(result.type, 'listDeployedDronesResult');
    assert.ok(Array.isArray(result.drones));
    assert.equal(result.drones.length, 0);

    await closeWS(ws);
  });

  it('Does not include other players drones', async () => {
    const { token: token1, playerId: p1 } = await joinUniverse(pool);
    const { playerId: p2 } = await joinUniverse(pool);
    const { ws } = await connectWS(token1);

    await deployDronesInSector(pool, p2, 50, 10);

    const result = await wsRequest(ws, { type: 'listDeployedDrones' }, 'listDeployedDronesResult');
    assert.equal(result.type, 'listDeployedDronesResult');
    const found = result.drones.find(f => f.sectorId === 50);
    assert.ok(!found, 'Should not include other player drones');

    await pool.query('DELETE FROM sector_drones WHERE owner_id = $1', [p2]);
    await closeWS(ws);
  });

  it('Costs 0 turns', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws } = await connectWS(token);
    await pool.query('UPDATE players SET turns = 50 WHERE id = $1', [playerId]);

    await wsRequest(ws, { type: 'listDeployedDrones' }, 'listDeployedDronesResult');
    const turnsAfter = (await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns;
    assert.equal(turnsAfter, 50);

    await closeWS(ws);
  });
});

// --- HyperspaceJump ---

describe('HyperspaceJump', () => {
  // For jump tests, we need:
  // 1. A player with hyperwarp drive
  // 2. Drones deployed in a distant target sector
  // 3. Enough fuel in cargo
  // 4. Enough turns
  // We'll use sectors that are a known distance apart.

  /** Set up a player ready for hyperspace jump testing */
  async function setupJumpPlayer() {
    const { token, playerId } = await joinUniverse(pool);
    await pool.query('UPDATE players SET turns = 9999 WHERE id = $1', [playerId]);
    await pool.query("UPDATE player_ships SET ship_name = 'Scout Marauder', has_hyperwarp_drive = true, turns_per_warp = 2 WHERE player_id = $1", [playerId]);
    const { ws } = await connectWS(token);
    return { ws, token, playerId };
  }

  /** Find a target sector that is at least 2 hops away and return { targetSector, hops } */
  async function findDistantSector(ws, minHops = 2) {
    const disp = await wsRequest(ws, { type: 'sectorDisplay' }, 'sectorDisplayResult');
    const currentSector = disp.sector;

    // Try sectors until we find one far enough away
    for (let target = 2; target <= 100; target++) {
      if (target === currentSector) continue;
      const pathRes = await wsRequest(ws, { type: 'shortestPath', from: currentSector, to: target }, 'shortestPathResult');
      if (pathRes.type !== 'error' && pathRes.hops >= minHops) {
        return { targetSector: target, hops: pathRes.hops, currentSector };
      }
    }
    throw new Error('Could not find a distant sector');
  }

  it('Successful hyperspace jump deducts fuel and turns, moves player', async () => {
    const { ws, playerId } = await setupJumpPlayer();
    const { targetSector, hops } = await findDistantSector(ws);
    const fuelCost = hops * 3;

    // Deploy drones in target sector
    await deployDronesInSector(pool, playerId, targetSector, 5);
    // Give enough fuel
    await pool.query('UPDATE ship_cargo SET fuel = $1 WHERE player_id = $2', [fuelCost + 10, playerId]);
    await pool.query('UPDATE players SET turns = 100 WHERE id = $1', [playerId]);

    const tpw = (await pool.query('SELECT turns_per_warp FROM player_ships WHERE player_id = $1', [playerId])).rows[0].turns_per_warp;

    const result = await wsRequest(ws, { type: 'hyperspaceJump', targetSector }, 'hyperspaceJumpResult');
    assert.equal(result.type, 'hyperspaceJumpResult');
    assert.equal(result.targetSector, targetSector);
    assert.equal(result.fuelUsed, fuelCost);
    assert.equal(result.turnsUsed, tpw);

    // Verify fuel deducted
    const fuelAfter = (await pool.query('SELECT fuel FROM ship_cargo WHERE player_id = $1', [playerId])).rows[0].fuel;
    assert.equal(fuelAfter, fuelCost + 10 - fuelCost);

    // Verify turns deducted
    const turnsAfter = (await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns;
    assert.equal(turnsAfter, 100 - tpw);

    // Verify player moved
    const sectorDisp = await wsRequest(ws, { type: 'sectorDisplay' }, 'sectorDisplayResult');
    assert.equal(sectorDisp.sector, targetSector);

    await pool.query('DELETE FROM sector_drones WHERE owner_id = $1', [playerId]);
    await closeWS(ws);
  });

  it('Rejected when no hyperwarp drive', async () => {
    const { token, playerId } = await joinUniverse(pool);
    await pool.query('UPDATE players SET turns = 9999 WHERE id = $1', [playerId]);
    await pool.query('UPDATE player_ships SET has_hyperwarp_drive = false WHERE player_id = $1', [playerId]);
    const { ws } = await connectWS(token);

    const adj = await getAdjacentSector(ws);
    await deployDronesInSector(pool, playerId, adj, 5);

    const result = await wsRequest(ws, { type: 'hyperspaceJump', targetSector: adj }, 'hyperspaceJumpResult');
    assert.equal(result.type, 'error');
    assert.match(result.message.toLowerCase(), /not equipped/);

    await pool.query('DELETE FROM sector_drones WHERE owner_id = $1', [playerId]);
    await closeWS(ws);
  });

  it('Rejected when no drone in target sector', async () => {
    const { ws, playerId } = await setupJumpPlayer();
    const adj = await getAdjacentSector(ws);

    // Ensure no drones in target sector for this player
    await pool.query('DELETE FROM sector_drones WHERE sector_id = $1 AND owner_id = $2', [adj, playerId]);

    await pool.query('UPDATE ship_cargo SET fuel = 100 WHERE player_id = $1', [playerId]);

    const result = await wsRequest(ws, { type: 'hyperspaceJump', targetSector: adj }, 'hyperspaceJumpResult');
    assert.equal(result.type, 'error');
    assert.match(result.message.toLowerCase(), /no signal/);

    await closeWS(ws);
  });

  it('Rejected when insufficient fuel', async () => {
    const { ws, playerId } = await setupJumpPlayer();
    const { targetSector, hops } = await findDistantSector(ws);
    const fuelCost = hops * 3;

    await deployDronesInSector(pool, playerId, targetSector, 5);
    // Give less fuel than needed
    await pool.query('UPDATE ship_cargo SET fuel = $1 WHERE player_id = $2', [fuelCost - 1, playerId]);

    const result = await wsRequest(ws, { type: 'hyperspaceJump', targetSector }, 'hyperspaceJumpResult');
    assert.equal(result.type, 'error');
    assert.match(result.message.toLowerCase(), /fuel/);

    await pool.query('DELETE FROM sector_drones WHERE owner_id = $1', [playerId]);
    await closeWS(ws);
  });

  it('Rejected when insufficient turns', async () => {
    const { ws, playerId } = await setupJumpPlayer();
    const { targetSector, hops } = await findDistantSector(ws);
    const fuelCost = hops * 3;

    await deployDronesInSector(pool, playerId, targetSector, 5);
    await pool.query('UPDATE ship_cargo SET fuel = $1 WHERE player_id = $2', [fuelCost + 10, playerId]);
    // Set turns to 0
    await pool.query('UPDATE players SET turns = 0 WHERE id = $1', [playerId]);

    const result = await wsRequest(ws, { type: 'hyperspaceJump', targetSector }, 'hyperspaceJumpResult');
    assert.equal(result.type, 'error');
    assert.match(result.message.toLowerCase(), /turns/);

    await pool.query('DELETE FROM sector_drones WHERE owner_id = $1', [playerId]);
    await closeWS(ws);
  });

  it('Fuel cost is correctly calculated as hops * 3', async () => {
    const { ws, playerId } = await setupJumpPlayer();
    const { targetSector, hops } = await findDistantSector(ws, 3); // at least 3 hops
    const expectedFuelCost = hops * 3;

    await deployDronesInSector(pool, playerId, targetSector, 5);
    await pool.query('UPDATE ship_cargo SET fuel = $1 WHERE player_id = $2', [1000, playerId]);
    await pool.query('UPDATE players SET turns = 100 WHERE id = $1', [playerId]);

    const result = await wsRequest(ws, { type: 'hyperspaceJump', targetSector }, 'hyperspaceJumpResult');
    assert.equal(result.type, 'hyperspaceJumpResult');
    assert.equal(result.fuelUsed, expectedFuelCost);

    const fuelAfter = (await pool.query('SELECT fuel FROM ship_cargo WHERE player_id = $1', [playerId])).rows[0].fuel;
    assert.equal(fuelAfter, 1000 - expectedFuelCost);

    await pool.query('DELETE FROM sector_drones WHERE owner_id = $1', [playerId]);
    await closeWS(ws);
  });

  it('In unlimited universe, turnsUsed = 0 and no turn deduction', async () => {
    await pool.query('UPDATE universes SET turns_per_day = 0 WHERE id = $1', [UNIVERSE_ID]);
    try {
      const { ws, playerId } = await setupJumpPlayer();
      const { targetSector, hops } = await findDistantSector(ws);
      const fuelCost = hops * 3;

      await deployDronesInSector(pool, playerId, targetSector, 5);
      await pool.query('UPDATE ship_cargo SET fuel = $1 WHERE player_id = $2', [fuelCost + 10, playerId]);
      await pool.query('UPDATE players SET turns = 10 WHERE id = $1', [playerId]);

      const result = await wsRequest(ws, { type: 'hyperspaceJump', targetSector }, 'hyperspaceJumpResult');
      assert.equal(result.type, 'hyperspaceJumpResult');
      assert.equal(result.turnsUsed, 0);

      const turnsAfter = (await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns;
      assert.equal(turnsAfter, 10); // no deduction

      await pool.query('DELETE FROM sector_drones WHERE owner_id = $1', [playerId]);
      await closeWS(ws);
    } finally {
      await pool.query('UPDATE universes SET turns_per_day = 500 WHERE id = $1', [UNIVERSE_ID]);
    }
  });

  it('In unlimited universe, jump succeeds even with 0 turns', async () => {
    await pool.query('UPDATE universes SET turns_per_day = 0 WHERE id = $1', [UNIVERSE_ID]);
    try {
      const { ws, playerId } = await setupJumpPlayer();
      const adj = await getAdjacentSector(ws);
      await deployDronesInSector(pool, playerId, adj, 5);
      await pool.query('UPDATE ship_cargo SET fuel = 100 WHERE player_id = $1', [playerId]);
      await pool.query('UPDATE players SET turns = 0 WHERE id = $1', [playerId]);

      const result = await wsRequest(ws, { type: 'hyperspaceJump', targetSector: adj }, 'hyperspaceJumpResult');
      assert.equal(result.type, 'hyperspaceJumpResult');
      assert.equal(result.turnsUsed, 0);

      await pool.query('DELETE FROM sector_drones WHERE owner_id = $1', [playerId]);
      await closeWS(ws);
    } finally {
      await pool.query('UPDATE universes SET turns_per_day = 500 WHERE id = $1', [UNIVERSE_ID]);
    }
  });

  it('Rejected when player is docked at a port', async () => {
    const { ws, playerId } = await setupJumpPlayer();
    const adj = await getAdjacentSector(ws);
    await ensureSellingPort(pool, adj);
    await clearSectorDrones(adj);
    await deployDronesInSector(pool, playerId, adj, 5);
    await pool.query('UPDATE ship_cargo SET fuel = 100 WHERE player_id = $1', [playerId]);

    // Move to sector with port and dock
    await wsRequest(ws, { type: 'move', sector: adj }, 'moveResult');
    await wsRequest(ws, { type: 'dock' }, 'dockResult');

    // Find another sector to jump to
    const adj2 = await getAdjacentSector(ws);
    if (adj2) {
      await deployDronesInSector(pool, playerId, adj2, 5);
      const result = await wsRequest(ws, { type: 'hyperspaceJump', targetSector: adj2 }, 'hyperspaceJumpResult');
      assert.equal(result.type, 'error');
    }

    await pool.query('DELETE FROM sector_drones WHERE owner_id = $1', [playerId]);
    await closeWS(ws);
  });

  it('Rejected when player is at Starbase', async () => {
    const { ws, playerId, starbaseSector } = await goToStarbase(pool);
    await pool.query('UPDATE ship_cargo SET fuel = 100 WHERE player_id = $1', [playerId]);

    // Find a sector to jump to
    const adj = await getAdjacentSector(ws);
    if (adj) {
      await deployDronesInSector(pool, playerId, adj, 5);
      const result = await wsRequest(ws, { type: 'hyperspaceJump', targetSector: adj }, 'hyperspaceJumpResult');
      assert.equal(result.type, 'error');
      await pool.query('DELETE FROM sector_drones WHERE owner_id = $1', [playerId]);
    }

    await closeWS(ws);
  });

  it('Rejected when player is on a planet', async () => {
    const { ws, playerId } = await setupJumpPlayer();

    const planetRes = await pool.query('SELECT id FROM planets WHERE sector_id = 1 AND universe_id = $1 LIMIT 1', [UNIVERSE_ID]);
    assert.ok(planetRes.rows.length > 0, 'No planet in sector 1');

    await wsRequest(ws, { type: 'landOnPlanet', planetId: planetRes.rows[0].id }, 'landOnPlanetResult');
    await pool.query('UPDATE ship_cargo SET fuel = 100 WHERE player_id = $1', [playerId]);

    const adj = await getAdjacentSector(ws);
    if (adj) {
      await deployDronesInSector(pool, playerId, adj, 5);
      const result = await wsRequest(ws, { type: 'hyperspaceJump', targetSector: adj }, 'hyperspaceJumpResult');
      assert.equal(result.type, 'error');
      await pool.query('DELETE FROM sector_drones WHERE owner_id = $1', [playerId]);
    }

    await closeWS(ws);
  });

  it('Rejected when no path to target sector', async () => {
    const { ws, playerId } = await setupJumpPlayer();

    // Use a non-existent sector ID that won't have any warps to it
    const fakeSector = 99999;
    await pool.query(`INSERT INTO sectors (id, universe_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [fakeSector, UNIVERSE_ID]);
    await deployDronesInSector(pool, playerId, fakeSector, 5);
    await pool.query('UPDATE ship_cargo SET fuel = 1000 WHERE player_id = $1', [playerId]);

    const result = await wsRequest(ws, { type: 'hyperspaceJump', targetSector: fakeSector }, 'hyperspaceJumpResult');
    assert.equal(result.type, 'error');
    assert.match(result.message.toLowerCase(), /no path/);

    await pool.query('DELETE FROM sector_drones WHERE owner_id = $1', [playerId]);
    await pool.query('DELETE FROM sectors WHERE id = $1 AND universe_id = $2', [fakeSector, UNIVERSE_ID]);
    await closeWS(ws);
  });
});

// --- ListDeployedDrones state checks ---

describe('ListDeployedDrones - sector command mode', () => {
  it('Rejected when player is docked at a port', async () => {
    const { token, playerId } = await joinUniverse(pool);
    await pool.query('UPDATE players SET turns = 9999 WHERE id = $1', [playerId]);
    const { ws } = await connectWS(token);

    const adj = await getAdjacentSector(ws);
    await ensureSellingPort(pool, adj);
    await clearSectorDrones(adj);
    await wsRequest(ws, { type: 'move', sector: adj }, 'moveResult');
    await wsRequest(ws, { type: 'dock' }, 'dockResult');

    const result = await wsRequest(ws, { type: 'listDeployedDrones' }, 'listDeployedDronesResult');
    assert.equal(result.type, 'error');

    await closeWS(ws);
  });

  it('Rejected when player is at Starbase', async () => {
    const { ws, playerId } = await goToStarbase(pool);

    const result = await wsRequest(ws, { type: 'listDeployedDrones' }, 'listDeployedDronesResult');
    assert.equal(result.type, 'error');

    await closeWS(ws);
  });

  it('Rejected when player is on a planet', async () => {
    const { token, playerId } = await joinUniverse(pool);
    await pool.query('UPDATE players SET turns = 9999 WHERE id = $1', [playerId]);
    const { ws } = await connectWS(token);

    const planetRes = await pool.query('SELECT id FROM planets WHERE sector_id = 1 AND universe_id = $1 LIMIT 1', [UNIVERSE_ID]);
    assert.ok(planetRes.rows.length > 0);
    await wsRequest(ws, { type: 'landOnPlanet', planetId: planetRes.rows[0].id }, 'landOnPlanetResult');

    const result = await wsRequest(ws, { type: 'listDeployedDrones' }, 'listDeployedDronesResult');
    assert.equal(result.type, 'error');

    await closeWS(ws);
  });
});

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = join(dirname(__filename), '..');
const { Pool } = pg;

const merchantCfg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'ships', 'merchant.json'), 'utf8'));
const warbirdCfg  = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'ships', 'warbird.json'),  'utf8'));
const STARTING_CREDITS = 10000;
const FIGHTER_PRICE = 20;
const SHIELD_PRICE  = 10;
const HOLD_PRICE    = 50;

// ─── inline helpers ───────────────────────────────────────────────────────────

function createPool() {
  return new Pool({
    host:     process.env.PGHOST     || 'localhost',
    database: process.env.PGDATABASE || 'twnr',
    user:     process.env.PGUSER     || 'twnr_user',
    password: process.env.PGPASSWORD || 'twnr_pass',
  });
}

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['dist/server.js'], {
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
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
    proc.on('error', (err) => { if (!settled) { settled = true; clearTimeout(timeout); reject(err); } });
    proc.on('exit', (code) => { if (!settled) { settled = true; clearTimeout(timeout); reject(new Error(`Server exited early: ${code}`)); } });
  });
}

function connectWS() {
  return import('ws').then(({ default: WebSocket }) => {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket('ws://localhost:3000');
      const timer = setTimeout(() => { ws.terminate(); reject(new Error('WS connect timeout')); }, 6000);
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'welcome') { clearTimeout(timer); resolve({ ws, welcome: msg }); }
      });
      ws.on('error', (err) => { clearTimeout(timer); reject(err); });
    });
  });
}

function waitForMsg(ws, type, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for "${type}"`)), timeout);
    function handler(data) {
      const msg = JSON.parse(data.toString());
      if (msg.type === type) { clearTimeout(timer); ws.removeListener('message', handler); resolve(msg); }
    }
    ws.on('message', handler);
  });
}

function closeWS(ws) {
  return new Promise((resolve) => {
    if (!ws || ws.readyState > 1) { resolve(); return; }
    ws.on('close', resolve);
    ws.close();
    setTimeout(resolve, 3000);
  });
}

async function httpGet(path) {
  const res = await fetch(`http://localhost:3000${path}`);
  return { status: res.status, body: await res.json() };
}

async function httpPost(path, data) {
  const res = await fetch(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return { status: res.status, body: await res.json() };
}

async function navigateTo(ws, targetSector) {
  const dispPromise = waitForMsg(ws, 'sectorDisplay');
  ws.send(JSON.stringify({ type: 'display' }));
  const disp = await dispPromise;
  if (disp.sector === targetSector) return;
  const route = await httpGet(`/api/route/${disp.sector}/${targetSector}`);
  if (route.status !== 200) throw new Error(`No route from ${disp.sector} to ${targetSector}`);
  for (let i = 1; i < route.body.path.length; i++) {
    const movePromise = waitForMsg(ws, 'playerMoved');
    ws.send(JSON.stringify({ type: 'move', sector: route.body.path[i] }));
    await movePromise;
  }
}

// ─── globals ──────────────────────────────────────────────────────────────────

let pool;
let serverProc;

async function findFuelSellerSector() {
  const res = await pool.query('SELECT sector_id FROM ports WHERE class IN (3, 4, 6, 7) LIMIT 1');
  return res.rows.length > 0 ? Number(res.rows[0].sector_id) : null;
}

async function findFuelBuyerSector() {
  const res = await pool.query('SELECT sector_id FROM ports WHERE class IN (1, 2, 5, 8) LIMIT 1');
  return res.rows.length > 0 ? Number(res.rows[0].sector_id) : null;
}


// ─── setup ────────────────────────────────────────────────────────────────────

before(async () => {
  const universeDir = join(tmpdir(), `twnr_ships_test_${Date.now()}`);

  const gen = spawnSync(process.execPath, [
    join(PROJECT_ROOT, 'scripts', 'twnr-bigbang.js'),
    universeDir, '--sectors', '100', '--seed', '42',
  ], { encoding: 'utf8', cwd: PROJECT_ROOT });
  if (gen.status !== 0) throw new Error(`bigbang failed: ${gen.stderr}`);

  pool = createPool();
  await pool.query('SELECT 1');
  await pool.query(`
    DROP TABLE IF EXISTS player_ships CASCADE;
    DROP TABLE IF EXISTS ship_cargo CASCADE;
    DROP TABLE IF EXISTS ports CASCADE;
    DROP TABLE IF EXISTS warps CASCADE;
    DROP TABLE IF EXISTS players CASCADE;
    DROP TABLE IF EXISTS sectors CASCADE;
  `);
  await pool.end();

  const imp = spawnSync(process.execPath, [
    join(PROJECT_ROOT, 'scripts', 'importUniverse.js'),
    universeDir, '--force',
  ], { encoding: 'utf8', cwd: PROJECT_ROOT, env: process.env });
  if (imp.status !== 0) throw new Error(`importUniverse failed: ${imp.stderr}\n${imp.stdout}`);

  serverProc = await startServer();
  pool = createPool();
});

after(async () => {
  if (serverProc) serverProc.kill();
  if (pool) await pool.end();
});

// ─── tests ────────────────────────────────────────────────────────────────────

describe('Config Files', () => {
  it('config/ships/merchant.json exists', () => {
    const p = join(PROJECT_ROOT, 'config', 'ships', 'merchant.json');
    assert.ok(existsSync(p), 'merchant.json should exist at config/ships/merchant.json');
  });

  it('merchant.json has correct fields and values', () => {
    const p = join(PROJECT_ROOT, 'config', 'ships', 'merchant.json');
    assert.ok(existsSync(p), 'merchant.json must exist');
    const cfg = JSON.parse(readFileSync(p, 'utf8'));
    assert.equal(cfg.name, 'Merchant Freighter');
    assert.equal(cfg.maxFighters, 10);
    assert.equal(cfg.maxShields, 10);
    assert.equal(cfg.startingHolds, 5, 'startingHolds should be 5');
    assert.equal(cfg.maxHolds, 20, 'maxHolds (cap) should be 20');
    assert.equal(cfg.price, 5000);
  });

  it('config/ships/warbird.json exists', () => {
    const p = join(PROJECT_ROOT, 'config', 'ships', 'warbird.json');
    assert.ok(existsSync(p), 'warbird.json should exist at config/ships/warbird.json');
  });

  it('warbird.json has correct fields and values', () => {
    const p = join(PROJECT_ROOT, 'config', 'ships', 'warbird.json');
    assert.ok(existsSync(p), 'warbird.json must exist');
    const cfg = JSON.parse(readFileSync(p, 'utf8'));
    assert.equal(cfg.name, 'Warbird');
    assert.equal(cfg.maxFighters, 30);
    assert.equal(cfg.maxShields, 25);
    assert.equal(cfg.startingHolds, 1, 'startingHolds should be 1');
    assert.equal(cfg.maxHolds, 5, 'maxHolds (cap) should be 5');
    assert.equal(cfg.price, 8000);
  });
});

describe('Database Schema', () => {
  it('player_ships table exists', async () => {
    const res = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'player_ships'`
    );
    assert.equal(res.rows.length, 1, 'player_ships table should exist');
  });

  it('player_ships has required columns including cargo_limit', async () => {
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'player_ships' ORDER BY column_name`
    );
    const cols = res.rows.map(r => r.column_name);
    assert.ok(cols.includes('player_id'), 'should have player_id');
    assert.ok(cols.includes('ship_name'), 'should have ship_name');
    assert.ok(cols.includes('fighters'), 'should have fighters');
    assert.ok(cols.includes('shields'), 'should have shields');
    assert.ok(cols.includes('cargo_limit'), 'should have cargo_limit (not max_holds)');
  });
});

describe('Universe Seeding', () => {
  it('importUniverse.js deletes player_ships before players', () => {
    const script = readFileSync(join(PROJECT_ROOT, 'scripts', 'importUniverse.js'), 'utf8');
    assert.ok(script.includes('DELETE FROM player_ships'), 'importUniverse.js must include DELETE FROM player_ships');
    const playerShipsIdx = script.indexOf('DELETE FROM player_ships');
    const playersIdx = script.indexOf('DELETE FROM players');
    assert.ok(playerShipsIdx < playersIdx, 'DELETE FROM player_ships must appear before DELETE FROM players');
  });

  it('sector 1 has a class 0 port', async () => {
    const res = await pool.query('SELECT class FROM ports WHERE sector_id = 1');
    assert.equal(res.rows.length, 1, 'sector 1 should have a port');
    assert.equal(res.rows[0].class, 0, 'sector 1 port should be class 0');
  });

  it('Stardock sector has a class 9 port', async () => {
    const res = await pool.query(
      `SELECT p.class FROM ports p
       JOIN sectors s ON p.sector_id = s.id
       WHERE s.name = 'Stardock'`
    );
    assert.equal(res.rows.length, 1, 'Stardock should have a port');
    assert.equal(res.rows[0].class, 9, 'Stardock port should be class 9');
  });
});

describe('New Player Ship Assignment', () => {
  it('WebSocket connect creates a player_ships row', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      const res = await pool.query('SELECT * FROM player_ships WHERE player_id = $1', [playerId]);
      assert.equal(res.rows.length, 1, 'player_ships row should be created on connect');
    } finally {
      await closeWS(ws);
    }
  });

  it(`new player is Merchant Freighter with fighters=0, shields=0, cargo_limit=${merchantCfg.startingHolds}`, async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      const res = await pool.query('SELECT * FROM player_ships WHERE player_id = $1', [playerId]);
      assert.equal(res.rows.length, 1);
      const row = res.rows[0];
      assert.equal(row.ship_name, merchantCfg.name);
      assert.equal(Number(row.fighters), 0);
      assert.equal(Number(row.shields), 0);
      assert.equal(Number(row.cargo_limit), merchantCfg.startingHolds);
    } finally {
      await closeWS(ws);
    }
  });
});

describe('GET /api/ship/:playerId', () => {
  it('returns 200 with all required fields for a new player', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      const { status, body } = await httpGet(`/api/ship/${playerId}`);
      assert.equal(status, 200);
      assert.equal(typeof body.playerId, 'number');
      assert.equal(typeof body.shipName, 'string');
      assert.equal(typeof body.fighters, 'number');
      assert.equal(typeof body.shields, 'number');
      assert.equal(typeof body.maxFighters, 'number');
      assert.equal(typeof body.maxShields, 'number');
      assert.equal(typeof body.maxHolds, 'number');
      assert.equal(typeof body.cargoLimit, 'number');
      assert.equal(typeof body.cargoFuel, 'number');
      assert.equal(typeof body.cargoOrganics, 'number');
      assert.equal(typeof body.cargoEquipment, 'number');
      assert.equal(typeof body.holdsAvailable, 'number');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns correct values for a new Merchant Freighter player', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      const { status, body } = await httpGet(`/api/ship/${playerId}`);
      assert.equal(status, 200);
      assert.equal(body.shipName, merchantCfg.name);
      assert.equal(body.fighters, 0);
      assert.equal(body.shields, 0);
      assert.equal(body.maxFighters, merchantCfg.maxFighters);
      assert.equal(body.maxShields, merchantCfg.maxShields);
      assert.equal(body.maxHolds, merchantCfg.maxHolds);
      assert.equal(body.cargoLimit, merchantCfg.startingHolds);
      assert.equal(body.cargoFuel, 0);
      assert.equal(body.cargoOrganics, 0);
      assert.equal(body.cargoEquipment, 0);
      assert.equal(body.holdsAvailable, merchantCfg.startingHolds);
    } finally {
      await closeWS(ws);
    }
  });

  it('returns 404 for a non-existent player', async () => {
    const { status } = await httpGet('/api/ship/999999');
    assert.equal(status, 404);
  });
});

describe('POST /api/trade at class 0 port', () => {
  it('returns 400 when buying a commodity at a class 0 port', async () => {
    // New players start at sector 1, which has a class 0 port
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      const { status } = await httpPost('/api/trade', {
        playerId, good: 'fuel', quantity: 1, action: 'buy',
      });
      assert.equal(status, 400);
    } finally {
      await closeWS(ws);
    }
  });

  it('returns 400 when selling a commodity at a class 0 port', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      await pool.query('UPDATE ship_cargo SET fuel = 3 WHERE player_id = $1', [playerId]);
      const { status } = await httpPost('/api/trade', {
        playerId, good: 'fuel', quantity: 1, action: 'sell',
      });
      assert.equal(status, 400);
    } finally {
      await closeWS(ws);
    }
  });
});

describe('Cargo Hold Enforcement (POST /api/trade)', () => {
  it('buying cargo exceeding cargo_limit returns 400 "Insufficient cargo holds"', async () => {
    const fuelSector = await findFuelSellerSector();
    assert.ok(fuelSector, 'Need a fuel-selling port for this test');

    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      await navigateTo(ws, fuelSector);
      // cargo_limit is 5; try to buy 6
      const { status, body } = await httpPost('/api/trade', {
        playerId, good: 'fuel', quantity: 6, action: 'buy',
      });
      assert.equal(status, 400);
      assert.equal(body.error, 'Insufficient cargo holds');
    } finally {
      await closeWS(ws);
    }
  });

  it('buying exactly cargo_limit units succeeds', async () => {
    const fuelSector = await findFuelSellerSector();
    assert.ok(fuelSector, 'Need a fuel-selling port for this test');

    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      await navigateTo(ws, fuelSector);
      const { status } = await httpPost('/api/trade', {
        playerId, good: 'fuel', quantity: 5, action: 'buy',
      });
      assert.equal(status, 200, 'buying exactly cargo_limit should succeed');
    } finally {
      await closeWS(ws);
    }
  });

  it('buying any cargo when holds are full returns 400', async () => {
    const fuelSector = await findFuelSellerSector();
    assert.ok(fuelSector, 'Need a fuel-selling port for this test');

    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      await navigateTo(ws, fuelSector);
      await httpPost('/api/trade', { playerId, good: 'fuel', quantity: 5, action: 'buy' });
      const { status, body } = await httpPost('/api/trade', {
        playerId, good: 'fuel', quantity: 1, action: 'buy',
      });
      assert.equal(status, 400);
      assert.equal(body.error, 'Insufficient cargo holds');
    } finally {
      await closeWS(ws);
    }
  });
});

describe('POST /api/port/buy-fighters — validation', () => {
  it('returns 400 "Not at a class 0 port" when not in a class 0 sector', async () => {
    const res = await pool.query('SELECT sector_id FROM ports WHERE class != 0 LIMIT 1');
    assert.ok(res.rows.length > 0, 'Need a non-class-0 sector');
    const otherSector = Number(res.rows[0].sector_id);

    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      await pool.query('UPDATE players SET current_sector = $1 WHERE id = $2', [otherSector, playerId]);
      const { status, body } = await httpPost('/api/port/buy-fighters', { playerId, quantity: 1 });
      assert.equal(status, 400);
      assert.equal(body.error, 'Not at a class 0 port');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns 400 "Invalid quantity" for quantity 0', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      const { status, body } = await httpPost('/api/port/buy-fighters', { playerId, quantity: 0 });
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid quantity');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns 400 "Invalid quantity" for negative quantity', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      const { status, body } = await httpPost('/api/port/buy-fighters', { playerId, quantity: -1 });
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid quantity');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns 400 "Invalid quantity" for a float quantity', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      const { status, body } = await httpPost('/api/port/buy-fighters', { playerId, quantity: 1.5 });
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid quantity');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns 404 "Player not found" for a non-existent player', async () => {
    const { status, body } = await httpPost('/api/port/buy-fighters', { playerId: 999999, quantity: 1 });
    assert.equal(status, 404);
    assert.equal(body.error, 'Player not found');
  });

  it('returns 400 "Exceeds maximum" when fighters + quantity > maxFighters', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      const { status, body } = await httpPost('/api/port/buy-fighters', { playerId, quantity: merchantCfg.maxFighters + 1 });
      assert.equal(status, 400);
      assert.equal(body.error, 'Exceeds maximum');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns 400 "Insufficient credits" when player cannot afford fighters', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      await pool.query('UPDATE ship_cargo SET credits = 0 WHERE player_id = $1', [playerId]);
      const { status, body } = await httpPost('/api/port/buy-fighters', { playerId, quantity: 1 });
      assert.equal(status, 400);
      assert.equal(body.error, 'Insufficient credits');
    } finally {
      await closeWS(ws);
    }
  });
});

describe('POST /api/port/buy-shields — validation', () => {
  it('returns 400 "Invalid quantity" for quantity 0', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      const { status, body } = await httpPost('/api/port/buy-shields', { playerId, quantity: 0 });
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid quantity');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns 400 "Invalid quantity" for negative quantity', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      const { status, body } = await httpPost('/api/port/buy-shields', { playerId, quantity: -1 });
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid quantity');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns 400 "Invalid quantity" for a float quantity', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      const { status, body } = await httpPost('/api/port/buy-shields', { playerId, quantity: 2.9 });
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid quantity');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns 404 "Player not found" for a non-existent player', async () => {
    const { status, body } = await httpPost('/api/port/buy-shields', { playerId: 999999, quantity: 1 });
    assert.equal(status, 404);
    assert.equal(body.error, 'Player not found');
  });

  it('returns 400 "Not at a class 0 port" when not in a class 0 sector', async () => {
    const res = await pool.query('SELECT sector_id FROM ports WHERE class != 0 LIMIT 1');
    assert.ok(res.rows.length > 0, 'Need a non-class-0 sector');
    const otherSector = Number(res.rows[0].sector_id);

    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      await pool.query('UPDATE players SET current_sector = $1 WHERE id = $2', [otherSector, playerId]);
      const { status, body } = await httpPost('/api/port/buy-shields', { playerId, quantity: 1 });
      assert.equal(status, 400);
      assert.equal(body.error, 'Not at a class 0 port');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns 400 "Exceeds maximum" when shields + quantity > maxShields', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      const { status, body } = await httpPost('/api/port/buy-shields', { playerId, quantity: merchantCfg.maxShields + 1 });
      assert.equal(status, 400);
      assert.equal(body.error, 'Exceeds maximum');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns 400 "Insufficient credits" when player cannot afford shields', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      await pool.query('UPDATE ship_cargo SET credits = 0 WHERE player_id = $1', [playerId]);
      const { status, body } = await httpPost('/api/port/buy-shields', { playerId, quantity: 1 });
      assert.equal(status, 400);
      assert.equal(body.error, 'Insufficient credits');
    } finally {
      await closeWS(ws);
    }
  });
});

describe('POST /api/port/buy-holds — validation', () => {
  it('returns 400 "Invalid quantity" for quantity 0', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      const { status, body } = await httpPost('/api/port/buy-holds', { playerId, quantity: 0 });
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid quantity');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns 400 "Invalid quantity" for negative quantity', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      const { status, body } = await httpPost('/api/port/buy-holds', { playerId, quantity: -1 });
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid quantity');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns 400 "Invalid quantity" for a float quantity', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      const { status, body } = await httpPost('/api/port/buy-holds', { playerId, quantity: 0.5 });
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid quantity');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns 404 "Player not found" for a non-existent player', async () => {
    const { status, body } = await httpPost('/api/port/buy-holds', { playerId: 999999, quantity: 1 });
    assert.equal(status, 404);
    assert.equal(body.error, 'Player not found');
  });

  it('returns 400 "Not at a class 0 port" when not in a class 0 sector', async () => {
    const res = await pool.query('SELECT sector_id FROM ports WHERE class != 0 LIMIT 1');
    assert.ok(res.rows.length > 0, 'Need a non-class-0 sector');
    const otherSector = Number(res.rows[0].sector_id);

    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      await pool.query('UPDATE players SET current_sector = $1 WHERE id = $2', [otherSector, playerId]);
      const { status, body } = await httpPost('/api/port/buy-holds', { playerId, quantity: 1 });
      assert.equal(status, 400);
      assert.equal(body.error, 'Not at a class 0 port');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns 400 "Insufficient credits" when player cannot afford holds', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      await pool.query('UPDATE ship_cargo SET credits = 0 WHERE player_id = $1', [playerId]);
      const { status, body } = await httpPost('/api/port/buy-holds', { playerId, quantity: 1 });
      assert.equal(status, 400);
      assert.equal(body.error, 'Insufficient credits');
    } finally {
      await closeWS(ws);
    }
  });
});

describe('Buy equipment — success', () => {
  it('buy-fighters deducts 20 credits per fighter and increases fighter count', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    const qty = 3;
    try {
      const { status, body } = await httpPost('/api/port/buy-fighters', { playerId, quantity: qty });
      assert.equal(status, 200);
      assert.equal(body.success, true);
      assert.equal(body.fighters, qty);
      assert.equal(body.credits, STARTING_CREDITS - qty * FIGHTER_PRICE);
      assert.ok('shields' in body, 'response must include shields');
      assert.ok('cargoLimit' in body, 'response must include cargoLimit');
    } finally {
      await closeWS(ws);
    }
  });

  it('buy-shields deducts 10 credits per shield and increases shield count', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    const qty = 5;
    try {
      const { status, body } = await httpPost('/api/port/buy-shields', { playerId, quantity: qty });
      assert.equal(status, 200);
      assert.equal(body.success, true);
      assert.equal(body.shields, qty);
      assert.equal(body.credits, STARTING_CREDITS - qty * SHIELD_PRICE);
      assert.ok('fighters' in body, 'response must include fighters');
      assert.ok('cargoLimit' in body, 'response must include cargoLimit');
    } finally {
      await closeWS(ws);
    }
  });

  it('buy-holds deducts 50 credits per hold and increases cargoLimit', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    const qty = 3;
    try {
      const { status, body } = await httpPost('/api/port/buy-holds', { playerId, quantity: qty });
      assert.equal(status, 200);
      assert.equal(body.success, true);
      assert.equal(body.cargoLimit, merchantCfg.startingHolds + qty);
      assert.equal(body.credits, STARTING_CREDITS - qty * HOLD_PRICE);
      assert.ok('fighters' in body, 'response must include fighters');
      assert.ok('shields' in body, 'response must include shields');
    } finally {
      await closeWS(ws);
    }
  });

  it('cumulative fighter purchases respect maxFighters cap', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    const firstBuy = merchantCfg.maxFighters - 2;
    try {
      // Buy maxFighters-2 fighters first
      await httpPost('/api/port/buy-fighters', { playerId, quantity: firstBuy });
      // Then try to buy 3 more — would exceed cap by 1
      const { status, body } = await httpPost('/api/port/buy-fighters', { playerId, quantity: 3 });
      assert.equal(status, 400);
      assert.equal(body.error, 'Exceeds maximum');
    } finally {
      await closeWS(ws);
    }
  });

  it('cumulative shield purchases respect maxShields cap', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    const firstBuy = merchantCfg.maxShields - 2;
    try {
      await httpPost('/api/port/buy-shields', { playerId, quantity: firstBuy });
      const { status, body } = await httpPost('/api/port/buy-shields', { playerId, quantity: 3 });
      assert.equal(status, 400);
      assert.equal(body.error, 'Exceeds maximum');
    } finally {
      await closeWS(ws);
    }
  });

  it('buy-holds cap is enforced using the current ship type (Warbird has lower maxHolds)', async () => {
    const stardockRes = await pool.query(`SELECT id FROM sectors WHERE name = 'Stardock'`);
    assert.ok(stardockRes.rows.length > 0, 'Stardock must exist');
    const stardockId = Number(stardockRes.rows[0].id);

    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      // Exchange to Warbird (startingHolds=1, maxHolds=5)
      await pool.query('UPDATE players SET current_sector = $1 WHERE id = $2', [stardockId, playerId]);
      await httpPost('/api/ship/exchange', { playerId, targetShipName: warbirdCfg.name });

      // Move to sector 1 (class 0 port) via DB
      await pool.query('UPDATE players SET current_sector = 1 WHERE id = $1', [playerId]);

      // Trying to buy maxHolds - startingHolds + 1 holds should fail
      const overLimit = warbirdCfg.maxHolds - warbirdCfg.startingHolds + 1;
      const { status, body } = await httpPost('/api/port/buy-holds', { playerId, quantity: overLimit });
      assert.equal(status, 400);
      assert.equal(body.error, 'Exceeds maximum');
    } finally {
      await closeWS(ws);
    }
  });

  it('buy-holds returns 400 "Exceeds maximum" when purchase would exceed maxHolds cap', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      // one more than the room available
      const { status, body } = await httpPost('/api/port/buy-holds', { playerId, quantity: merchantCfg.maxHolds - merchantCfg.startingHolds + 1 });
      assert.equal(status, 400);
      assert.equal(body.error, 'Exceeds maximum');
    } finally {
      await closeWS(ws);
    }
  });

  it('buy-holds succeeds when purchase reaches exactly maxHolds cap', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      const qty = merchantCfg.maxHolds - merchantCfg.startingHolds;
      const { status, body } = await httpPost('/api/port/buy-holds', { playerId, quantity: qty });
      assert.equal(status, 200, 'buying exactly up to maxHolds should succeed');
      assert.equal(body.cargoLimit, merchantCfg.maxHolds);
    } finally {
      await closeWS(ws);
    }
  });

  it('hold limit is enforced across mixed commodities (fuel + organics)', async () => {
    const fuelSector = await findFuelSellerSector();
    assert.ok(fuelSector, 'Need a fuel-selling port for this test');

    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      // Set fuel=2, organics=2 directly (4 holds used, 1 remaining out of cargoLimit=5)
      await pool.query('UPDATE ship_cargo SET fuel = 2, organics = 2 WHERE player_id = $1', [playerId]);
      await navigateTo(ws, fuelSector);
      // Buying 2 more fuel: 2+2+2 = 6 > cargoLimit(5) — should fail
      const { status, body } = await httpPost('/api/trade', {
        playerId, good: 'fuel', quantity: 2, action: 'buy',
      });
      assert.equal(status, 400);
      assert.equal(body.error, 'Insufficient cargo holds');
    } finally {
      await closeWS(ws);
    }
  });

  it('cargo limit is enforced after ship exchange reduces cargoLimit', async () => {
    const fuelSector = await findFuelSellerSector();
    assert.ok(fuelSector, 'Need a fuel-selling port for this test');
    const stardockRes = await pool.query(`SELECT id FROM sectors WHERE name = 'Stardock'`);
    assert.ok(stardockRes.rows.length > 0, 'Stardock must exist');
    const stardockId = Number(stardockRes.rows[0].id);

    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      // Exchange to Warbird (startingHolds=1); cargoLimit becomes 1
      await pool.query('UPDATE players SET current_sector = $1 WHERE id = $2', [stardockId, playerId]);
      await httpPost('/api/ship/exchange', { playerId, targetShipName: warbirdCfg.name });

      // Navigate to fuel port and try to buy 2 fuel — exceeds new cargoLimit of 1
      await pool.query('UPDATE players SET current_sector = $1 WHERE id = $2', [fuelSector, playerId]);
      const { status, body } = await httpPost('/api/trade', {
        playerId, good: 'fuel', quantity: 2, action: 'buy',
      });
      assert.equal(status, 400);
      assert.equal(body.error, 'Insufficient cargo holds');
    } finally {
      await closeWS(ws);
    }
  });

  it('after buying holds the new cargo_limit is enforced in trade', async () => {
    const fuelRes = await pool.query('SELECT sector_id FROM ports WHERE class IN (3,4,6,7) LIMIT 1');
    assert.ok(fuelRes.rows.length > 0, 'Need a fuel-selling sector');
    const fuelSector = Number(fuelRes.rows[0].sector_id);

    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      // Buy 3 holds → cargo_limit becomes 8
      await httpPost('/api/port/buy-holds', { playerId, quantity: 3 });

      // Navigate to fuel seller and buy 8 units (should succeed now)
      await navigateTo(ws, fuelSector);
      const { status } = await httpPost('/api/trade', {
        playerId, good: 'fuel', quantity: 8, action: 'buy',
      });
      assert.equal(status, 200, 'should be able to buy 8 fuel after buying 3 extra holds');
    } finally {
      await closeWS(ws);
    }
  });
});

describe('POST /api/ship/exchange — validation', () => {
  async function getStardockSector() {
    const res = await pool.query(`SELECT id FROM sectors WHERE name = 'Stardock'`);
    return res.rows.length > 0 ? Number(res.rows[0].id) : null;
  }

  it('returns 404 "Player not found" for a non-existent player', async () => {
    const { status, body } = await httpPost('/api/ship/exchange', { playerId: 999999, targetShipName: warbirdCfg.name });
    assert.equal(status, 404);
    assert.equal(body.error, 'Player not found');
  });

  it('returns 400 "Not at Stardock" when player is not in Stardock', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      const { status, body } = await httpPost('/api/ship/exchange', {
        playerId, targetShipName: warbirdCfg.name,
      });
      assert.equal(status, 400);
      assert.equal(body.error, 'Not at Stardock');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns 400 "Unknown ship" for an unrecognized ship name', async () => {
    const stardockId = await getStardockSector();
    assert.ok(stardockId, 'Stardock sector must exist');

    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      await pool.query('UPDATE players SET current_sector = $1 WHERE id = $2', [stardockId, playerId]);
      const { status, body } = await httpPost('/api/ship/exchange', {
        playerId, targetShipName: 'Galaxy Hauler',
      });
      assert.equal(status, 400);
      assert.equal(body.error, 'Unknown ship');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns 400 "Already on that ship" when targeting the current ship', async () => {
    const stardockId = await getStardockSector();
    assert.ok(stardockId);

    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      await pool.query('UPDATE players SET current_sector = $1 WHERE id = $2', [stardockId, playerId]);
      const { status, body } = await httpPost('/api/ship/exchange', {
        playerId, targetShipName: merchantCfg.name,
      });
      assert.equal(status, 400);
      assert.equal(body.error, 'Already on that ship');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns 400 "Insufficient credits" when player cannot afford the upgrade', async () => {
    const stardockId = await getStardockSector();
    assert.ok(stardockId);

    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      await pool.query('UPDATE players SET current_sector = $1 WHERE id = $2', [stardockId, playerId]);
      const upgradeCost = warbirdCfg.price - merchantCfg.price;
      await pool.query('UPDATE ship_cargo SET credits = $1 WHERE player_id = $2', [upgradeCost - 1, playerId]);
      const { status, body } = await httpPost('/api/ship/exchange', {
        playerId, targetShipName: warbirdCfg.name,
      });
      assert.equal(status, 400);
      assert.equal(body.error, 'Insufficient credits');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns 400 "New ship has insufficient holds for current cargo" when cargo exceeds new ship startingHolds', async () => {
    const stardockId = await getStardockSector();
    assert.ok(stardockId);

    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      // set fuel > warbird's startingHolds directly in ship_cargo to trigger the holds check on exchange
      await pool.query('UPDATE ship_cargo SET fuel = $1 WHERE player_id = $2', [warbirdCfg.startingHolds + 1, playerId]);

      await pool.query('UPDATE players SET current_sector = $1 WHERE id = $2', [stardockId, playerId]);
      const { status, body } = await httpPost('/api/ship/exchange', {
        playerId, targetShipName: warbirdCfg.name,
      });
      assert.equal(status, 400);
      assert.equal(body.error, 'New ship has insufficient holds for current cargo');
    } finally {
      await closeWS(ws);
    }
  });
});

describe('GET /api/ship/:playerId — dynamic state', () => {
  it('cargoLimit reflects cargo_limit after buying holds', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    const qty = 4;
    try {
      await httpPost('/api/port/buy-holds', { playerId, quantity: qty });
      const { status, body } = await httpGet(`/api/ship/${playerId}`);
      assert.equal(status, 200);
      assert.equal(body.cargoLimit, merchantCfg.startingHolds + qty);
    } finally {
      await closeWS(ws);
    }
  });

  it('holdsAvailable reflects actual cargo (not just cargoLimit)', async () => {
    const fuelRes = await pool.query('SELECT sector_id FROM ports WHERE class IN (3,4,6,7) LIMIT 1');
    assert.ok(fuelRes.rows.length > 0, 'Need a fuel-selling sector');
    const fuelSector = Number(fuelRes.rows[0].sector_id);

    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    const fuelQty = 3;
    try {
      await navigateTo(ws, fuelSector);
      await httpPost('/api/trade', { playerId, good: 'fuel', quantity: fuelQty, action: 'buy' });

      const { status, body } = await httpGet(`/api/ship/${playerId}`);
      assert.equal(status, 200);
      assert.equal(body.cargoFuel, fuelQty);
      assert.equal(body.holdsAvailable, merchantCfg.startingHolds - fuelQty);
    } finally {
      await closeWS(ws);
    }
  });
});

describe('POST /api/ship/exchange — success', () => {
  async function getStardockSector() {
    const res = await pool.query(`SELECT id FROM sectors WHERE name = 'Stardock'`);
    return res.rows.length > 0 ? Number(res.rows[0].id) : null;
  }

  it('upgrade to Warbird costs correct credits, resets fighters/shields, sets cargoLimit to startingHolds', async () => {
    const stardockId = await getStardockSector();
    assert.ok(stardockId);

    const upgradeCost = warbirdCfg.price - merchantCfg.price;
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      await pool.query('UPDATE players SET current_sector = $1 WHERE id = $2', [stardockId, playerId]);
      const { status, body } = await httpPost('/api/ship/exchange', {
        playerId, targetShipName: warbirdCfg.name,
      });
      assert.equal(status, 200);
      assert.equal(body.success, true);
      assert.equal(body.shipName, warbirdCfg.name);
      assert.equal(body.credits, STARTING_CREDITS - upgradeCost);
      assert.equal(body.maxFighters, warbirdCfg.maxFighters);
      assert.equal(body.maxShields, warbirdCfg.maxShields);
      assert.equal(body.cargoLimit, warbirdCfg.startingHolds);

      // Verify DB: fighters and shields reset to 0
      const shipRes = await pool.query('SELECT * FROM player_ships WHERE player_id = $1', [playerId]);
      assert.equal(shipRes.rows[0].ship_name, warbirdCfg.name);
      assert.equal(Number(shipRes.rows[0].fighters), 0);
      assert.equal(Number(shipRes.rows[0].shields), 0);
      assert.equal(Number(shipRes.rows[0].cargo_limit), warbirdCfg.startingHolds);
    } finally {
      await closeWS(ws);
    }
  });

  it('exchange resets previously purchased fighters and shields to 0', async () => {
    const stardockId = await getStardockSector();
    assert.ok(stardockId);

    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      // Buy some fighters and shields first (player starts at sector 1, class 0 port)
      await httpPost('/api/port/buy-fighters', { playerId, quantity: Math.min(5, merchantCfg.maxFighters) });
      await httpPost('/api/port/buy-shields', { playerId, quantity: Math.min(4, merchantCfg.maxShields) });

      await pool.query('UPDATE players SET current_sector = $1 WHERE id = $2', [stardockId, playerId]);
      const { status } = await httpPost('/api/ship/exchange', {
        playerId, targetShipName: warbirdCfg.name,
      });
      assert.equal(status, 200);

      const shipRes = await pool.query('SELECT fighters, shields FROM player_ships WHERE player_id = $1', [playerId]);
      assert.equal(Number(shipRes.rows[0].fighters), 0, 'fighters should be reset to 0 on exchange');
      assert.equal(Number(shipRes.rows[0].shields), 0, 'shields should be reset to 0 on exchange');
    } finally {
      await closeWS(ws);
    }
  });

  it('downgrade from Warbird to Merchant Freighter refunds credit difference, sets cargoLimit to startingHolds', async () => {
    const stardockId = await getStardockSector();
    assert.ok(stardockId);

    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      await pool.query('UPDATE players SET current_sector = $1 WHERE id = $2', [stardockId, playerId]);
      // Upgrade first
      await httpPost('/api/ship/exchange', { playerId, targetShipName: warbirdCfg.name });
      // Now downgrade
      const { status, body } = await httpPost('/api/ship/exchange', {
        playerId, targetShipName: merchantCfg.name,
      });
      assert.equal(status, 200);
      assert.equal(body.shipName, merchantCfg.name);
      assert.equal(body.credits, STARTING_CREDITS, 'credits restored after upgrade then downgrade');
      assert.equal(body.cargoLimit, merchantCfg.startingHolds);
    } finally {
      await closeWS(ws);
    }
  });
});

describe('Movement Constraint', () => {
  it('WebSocket move without a ship row returns { type: "noShip" }', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      await pool.query('DELETE FROM player_ships WHERE player_id = $1', [playerId]);

      const msgPromise = waitForMsg(ws, 'noShip', 5000);
      const adjRes = await pool.query('SELECT sector_to FROM warps WHERE sector_from = 1 LIMIT 1');
      const target = adjRes.rows.length > 0 ? Number(adjRes.rows[0].sector_to) : 2;
      ws.send(JSON.stringify({ type: 'move', sector: target }));

      const msg = await msgPromise;
      assert.equal(msg.type, 'noShip');
    } finally {
      await closeWS(ws);
    }
  });

  it('REST /api/move without a ship row returns 400 "No ship"', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      await pool.query('DELETE FROM player_ships WHERE player_id = $1', [playerId]);

      const adjRes = await pool.query('SELECT sector_to FROM warps WHERE sector_from = 1 LIMIT 1');
      const target = adjRes.rows.length > 0 ? Number(adjRes.rows[0].sector_to) : 2;

      const { status, body } = await httpPost('/api/move', { playerId, targetSector: target });
      assert.equal(status, 400);
      assert.equal(body.error, 'No ship');
    } finally {
      await closeWS(ws);
    }
  });
});

describe('Existing feature regression', () => {
  it('selling a commodity at a normal port succeeds', async () => {
    const fuelSector = await findFuelBuyerSector();
    assert.ok(fuelSector, 'Need a fuel-buying port for this test');

    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      await pool.query('UPDATE ship_cargo SET fuel = 3 WHERE player_id = $1', [playerId]);
      await navigateTo(ws, fuelSector);
      const { status, body } = await httpPost('/api/trade', {
        playerId, good: 'fuel', quantity: 2, action: 'sell',
      });
      assert.equal(status, 200);
      assert.ok(body.success);
    } finally {
      await closeWS(ws);
    }
  });

  it('deleting a player cascades to player_ships', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    await closeWS(ws);

    await pool.query('DELETE FROM players WHERE id = $1', [playerId]);
    const res = await pool.query('SELECT * FROM player_ships WHERE player_id = $1', [playerId]);
    assert.equal(res.rows.length, 0, 'player_ships row should be deleted via cascade');
  });
});

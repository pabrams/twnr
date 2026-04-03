import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  createPool,
  startServer,
  createTestUser,
  createTestPlayer,
  connectWS,
  closeWS,
  wsRequest,
  testEnv,
} from './helpers.mjs';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = join(dirname(__filename), '..');
const UNIVERSE_ID = 1;

let pool;
let serverProc;

async function createPlayer(name, sector = 1, fighters = 0, shields = 0) {
  const { userId, token } = await createTestUser(pool);
  const playerId = await createTestPlayer(pool, userId, UNIVERSE_ID, name, sector, fighters, shields);
  return { id: playerId, token };
}

async function connectPlayer(token) {
  return connectWS({ token, universeId: UNIVERSE_ID });
}

before(async () => {
  const universeDir = mkdtempSync(join(tmpdir(), 'twnr_attack_test_'));
  try {
    rmSync(universeDir, { recursive: true, force: true });
    const gen = spawnSync(process.execPath, [
      join(PROJECT_ROOT, 'scripts', 'twnr-bigbang.js'),
      universeDir, '--sectors', '100', '--seed', '42',
    ], { encoding: 'utf8', cwd: PROJECT_ROOT });
    if (gen.status !== 0) throw new Error(`bigbang failed: ${gen.stderr}`);

    pool = createPool();
    await pool.query('SELECT 1');
    await pool.query('DROP TABLE IF EXISTS planets, visited_sectors, ship_cargo, player_ships, ports, warps, players, sectors, universes, users CASCADE');
    await pool.end();

    const imp = spawnSync(process.execPath, [
      join(PROJECT_ROOT, 'scripts', 'importUniverse.js'),
      universeDir, '--force',
    ], { encoding: 'utf8', cwd: PROJECT_ROOT, env: testEnv() });
    if (imp.status !== 0) throw new Error(`importUniverse failed: ${imp.stderr}`);

    serverProc = await startServer();
  } finally {
    rmSync(universeDir, { recursive: true, force: true });
  }

  pool = createPool();
});

after(async () => {
  if (serverProc) serverProc.kill();
  if (pool) await pool.end();
});

// ─── Login restriction for destroyed players ────────────────────────────────

describe('Login restriction after ship destruction', () => {
  it('allows login and gives new ship when delay has passed (default delay=0)', async () => {
    const ts = Date.now() + Math.random();
    const email = `destroyed_${ts}@test.com`;
    const password = 'testpass123';

    const regRes = await fetch('http://localhost:3000/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'DestroyedPlayer', email, password }),
    });
    assert.equal(regRes.status, 201);
    const { userId } = await regRes.json();

    // Join universe to create a player
    const regCookies = regRes.headers.getSetCookie?.() || [];
    let regToken = null;
    for (const c of regCookies) {
      const match = c.match(/twnr_auth=([^;]+)/);
      if (match) regToken = match[1];
    }

    const joinRes = await fetch(`http://localhost:3000/api/universes/${UNIVERSE_ID}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `twnr_auth=${regToken}` },
      body: JSON.stringify({ name: 'DestroyedPlayer' }),
    });
    assert.equal(joinRes.status, 201);
    const { playerId } = await joinRes.json();

    await pool.query('UPDATE players SET ship_destroyed_date = NOW() WHERE id = $1', [playerId]);

    const loginRes = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    assert.equal(loginRes.status, 200);

    const playerRes = await pool.query('SELECT ship_destroyed_date FROM players WHERE id = $1', [playerId]);
    assert.equal(playerRes.rows[0].ship_destroyed_date, null, 'ship_destroyed_date should be cleared');

    const shipRes = await pool.query('SELECT ship_name, fighters, shields, cargo_limit FROM player_ships WHERE player_id = $1', [playerId]);
    assert.equal(shipRes.rows.length, 1, 'Should have a new ship');
    assert.equal(shipRes.rows[0].ship_name, 'Merchant Freighter');
    assert.equal(shipRes.rows[0].fighters, 0);
    assert.equal(shipRes.rows[0].shields, 0);

    const cargoRes = await pool.query('SELECT credits FROM ship_cargo WHERE player_id = $1', [playerId]);
    assert.equal(cargoRes.rows.length, 1, 'Should have cargo');
    assert.equal(cargoRes.rows[0].credits, 10000);
  });

  it('refuses login with 403 when delay has not passed', async () => {
    const ts = Date.now() + Math.random();
    const email = `refused_${ts}@test.com`;
    const password = 'testpass456';

    const regRes = await fetch('http://localhost:3000/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'RefusedPlayer', email, password }),
    });
    assert.equal(regRes.status, 201);

    const regCookies = regRes.headers.getSetCookie?.() || [];
    let regToken = null;
    for (const c of regCookies) {
      const match = c.match(/twnr_auth=([^;]+)/);
      if (match) regToken = match[1];
    }

    const joinRes = await fetch(`http://localhost:3000/api/universes/${UNIVERSE_ID}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `twnr_auth=${regToken}` },
      body: JSON.stringify({ name: 'RefusedPlayer' }),
    });
    assert.equal(joinRes.status, 201);
    const { playerId } = await joinRes.json();

    // Set destroyed date 1 hour in the future → elapsed will be negative → always less than delay
    await pool.query(
      `UPDATE players SET ship_destroyed_date = NOW() + INTERVAL '1 hour' WHERE id = $1`,
      [playerId],
    );

    const loginRes = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    assert.equal(loginRes.status, 403, 'Should refuse login with 403');
    const body = await loginRes.json();
    assert.ok(
      body.error && body.error.toLowerCase().includes('destroyed'),
      `Error message should mention "destroyed", got: ${body.error}`,
    );
  });

  it('gives new Merchant Freighter with correct stats on re-login after destruction', async () => {
    const ts = Date.now() + Math.random();
    const email = `newship_${ts}@test.com`;
    const password = 'testpass789';

    const regRes = await fetch('http://localhost:3000/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'NewShipPlayer', email, password }),
    });
    assert.equal(regRes.status, 201);

    const regCookies = regRes.headers.getSetCookie?.() || [];
    let regToken = null;
    for (const c of regCookies) {
      const match = c.match(/twnr_auth=([^;]+)/);
      if (match) regToken = match[1];
    }

    const joinRes = await fetch(`http://localhost:3000/api/universes/${UNIVERSE_ID}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `twnr_auth=${regToken}` },
      body: JSON.stringify({ name: 'NewShipPlayer' }),
    });
    assert.equal(joinRes.status, 201);
    const { playerId } = await joinRes.json();

    await pool.query('DELETE FROM player_ships WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM ship_cargo WHERE player_id = $1', [playerId]);
    await pool.query(
      `UPDATE players SET ship_destroyed_date = NOW() - INTERVAL '1 hour' WHERE id = $1`,
      [playerId],
    );

    const loginRes = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(loginRes.status, 200);

    const ship = await pool.query(
      'SELECT ship_name, fighters, shields, cargo_limit FROM player_ships WHERE player_id = $1',
      [playerId],
    );
    assert.equal(ship.rows.length, 1);
    assert.equal(ship.rows[0].ship_name, 'Merchant Freighter');
    assert.equal(ship.rows[0].fighters, 0);
    assert.equal(ship.rows[0].shields, 0);

    const cargo = await pool.query('SELECT credits FROM ship_cargo WHERE player_id = $1', [playerId]);
    assert.equal(cargo.rows.length, 1);
    assert.equal(cargo.rows[0].credits, 10000);

    const player = await pool.query('SELECT ship_destroyed_date FROM players WHERE id = $1', [playerId]);
    assert.equal(player.rows[0].ship_destroyed_date, null);
  });
});

// ─── Attack result message ──────────────────────────────────────────────────

describe('Attack result message', () => {
  it('returns a non-error attackResult response on successful attack', async () => {
    const atk = await createPlayer('atk_fmt', 1, 5, 0);
    const def = await createPlayer('def_fmt', 1, 2, 3);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    try {
      const res = await wsRequest(ws1, { type: 'attack', targetPlayerId: def.id, fighters: 2 }, 'attackResult');
      assert.equal(res.type, 'attackResult', 'Should receive an attackResult message');
      assert.notEqual(res.type, 'error', 'Should not be an error');
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
    }
  });
});

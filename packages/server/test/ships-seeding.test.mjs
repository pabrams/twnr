import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPool, connectWS as _connectWS, closeWS, startServer, testEnv } from './helpers.mjs';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = join(dirname(__filename), '..');

const merchantCfg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'ships', 'merchant.json'), 'utf8'));
const UNIVERSE_ID = 1;

// ─── globals ──────────────────────────────────────────────────────────────────

let pool;
let serverProc;

function connectWS(opts = {}) {
  return _connectWS({ pool, universeId: UNIVERSE_ID, ...opts });
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
});

after(async () => {
  if (serverProc) serverProc.kill();
  if (pool) await pool.end();
});

// ─── tests ────────────────────────────────────────────────────────────────────

describe('Universe Seeding', () => {
  it('importUniverse.js deletes player_ships before players', () => {
    const script = readFileSync(join(PROJECT_ROOT, 'scripts', 'importUniverse.js'), 'utf8');
    assert.ok(script.includes('DELETE FROM player_ships'), 'importUniverse.js must include DELETE FROM player_ships');
    const playerShipsIdx = script.indexOf('DELETE FROM player_ships');
    const playersIdx = script.indexOf('DELETE FROM players');
    assert.ok(playerShipsIdx < playersIdx, 'DELETE FROM player_ships must appear before DELETE FROM players');
  });

  it('sector 1 has a class 0 port', async () => {
    const res = await pool.query('SELECT class FROM ports WHERE sector_id = 1 AND universe_id = $1', [UNIVERSE_ID]);
    assert.equal(res.rows.length, 1, 'sector 1 should have a port');
    assert.equal(res.rows[0].class, 0, 'sector 1 port should be class 0');
  });

  it('Stardock sector has a class 9 port', async () => {
    const res = await pool.query(
      `SELECT p.class FROM ports p
       JOIN sectors s ON p.sector_id = s.id AND p.universe_id = s.universe_id
       WHERE s.name = 'Stardock' AND s.universe_id = $1`, [UNIVERSE_ID]
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

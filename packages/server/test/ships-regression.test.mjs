import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPool, connectWS as _connectWS, closeWS, wsRequest, startServer, testEnv } from './helpers.mjs';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = join(dirname(__filename), '..');

const UNIVERSE_ID = 1;

async function navigateTo(ws, targetSector) {
  const disp = await wsRequest(ws, { type: 'sectorDisplay' }, 'sectorDisplay');
  if (disp.sector === targetSector) return;
  const path = await wsRequest(ws, { type: 'path', from: disp.sector, to: targetSector }, 'pathResult');
  if (path.type === 'error') throw new Error(`No path to ${targetSector}`);
  for (let i = 1; i < path.path.length; i++) {
    await wsRequest(ws, { type: 'move', sector: path.path[i] }, 'sectorDisplay');
  }
}

// ─── globals ──────────────────────────────────────────────────────────────────

let pool;
let serverProc;

function connectWS(opts = {}) {
  return _connectWS({ pool, universeId: UNIVERSE_ID, ...opts });
}

async function findFuelBuyerSector() {
  const res = await pool.query('SELECT sector_id FROM ports WHERE class IN (1, 2, 5, 8) AND universe_id = $1 LIMIT 1', [UNIVERSE_ID]);
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

describe('Movement Constraint', () => {
  it('WebSocket move without a ship row returns { type: "noShip" }', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      await pool.query('DELETE FROM player_ships WHERE player_id = $1', [playerId]);

      const adjRes = await pool.query('SELECT sector_to FROM warps WHERE sector_from = 1 AND universe_id = $1 LIMIT 1', [UNIVERSE_ID]);
      const target = adjRes.rows.length > 0 ? Number(adjRes.rows[0].sector_to) : 2;

      const msg = await wsRequest(ws, { type: 'move', sector: target }, 'noShip');
      assert.equal(msg.type, 'noShip');
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
      const msg = await wsRequest(ws, { type: 'portTransaction', good: 'fuel', quantity: 2, action: 'sell' }, 'portTransactionResult');
      assert.equal(msg.type, 'portTransactionResult');
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

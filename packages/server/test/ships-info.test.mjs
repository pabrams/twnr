import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPool, connectWS as _connectWS, closeWS, wsRequest, startServer, testEnv } from './helpers.mjs';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = join(dirname(__filename), '..');

const merchantCfg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'ships', 'merchant.json'), 'utf8'));
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

describe('Ship info query', () => {
  it('returns all required fields for a new player', async () => {
    const { ws } = await connectWS();
    try {
      const msg = await wsRequest(ws, { type: 'ship' }, 'shipInfo');
      assert.equal(msg.type, 'shipInfo');
      assert.equal(typeof msg.playerId, 'number');
      assert.equal(typeof msg.shipName, 'string');
      assert.equal(typeof msg.fighters, 'number');
      assert.equal(typeof msg.shields, 'number');
      assert.equal(typeof msg.maxFighters, 'number');
      assert.equal(typeof msg.maxShields, 'number');
      assert.equal(typeof msg.maxHolds, 'number');
      assert.equal(typeof msg.cargoLimit, 'number');
      assert.equal(typeof msg.cargoFuel, 'number');
      assert.equal(typeof msg.cargoOrganics, 'number');
      assert.equal(typeof msg.cargoEquipment, 'number');
      assert.equal(typeof msg.holdsAvailable, 'number');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns correct values for a new Merchant Freighter player', async () => {
    const { ws } = await connectWS();
    try {
      const msg = await wsRequest(ws, { type: 'ship' }, 'shipInfo');
      assert.equal(msg.type, 'shipInfo');
      assert.equal(msg.shipName, merchantCfg.name);
      assert.equal(msg.fighters, 0);
      assert.equal(msg.shields, 0);
      assert.equal(msg.maxFighters, merchantCfg.maxFighters);
      assert.equal(msg.maxShields, merchantCfg.maxShields);
      assert.equal(msg.maxHolds, merchantCfg.maxHolds);
      assert.equal(msg.cargoLimit, merchantCfg.startingHolds);
      assert.equal(msg.cargoFuel, 0);
      assert.equal(msg.cargoOrganics, 0);
      assert.equal(msg.cargoEquipment, 0);
      assert.equal(msg.holdsAvailable, merchantCfg.startingHolds);
    } finally {
      await closeWS(ws);
    }
  });
});

describe('Ship info — dynamic state', () => {
  it('cargoLimit reflects cargo_limit after buying holds', async () => {
    const { ws } = await connectWS();
    const qty = 4;
    try {
      await wsRequest(ws, { type: 'buyHolds', quantity: qty }, 'buyResult');
      const msg = await wsRequest(ws, { type: 'ship' }, 'shipInfo');
      assert.equal(msg.type, 'shipInfo');
      assert.equal(msg.cargoLimit, merchantCfg.startingHolds + qty);
    } finally {
      await closeWS(ws);
    }
  });

  it('holdsAvailable reflects actual cargo (not just cargoLimit)', async () => {
    const fuelRes = await pool.query('SELECT sector_id FROM ports WHERE class IN (3,4,6,7) AND universe_id = $1 LIMIT 1', [UNIVERSE_ID]);
    assert.ok(fuelRes.rows.length > 0, 'Need a fuel-selling sector');
    const fuelSector = Number(fuelRes.rows[0].sector_id);

    const { ws } = await connectWS();
    const fuelQty = 3;
    try {
      await navigateTo(ws, fuelSector);
      await wsRequest(ws, { type: 'portTransaction', good: 'fuel', quantity: fuelQty, action: 'buy' }, 'portTransactionResult');

      const msg = await wsRequest(ws, { type: 'ship' }, 'shipInfo');
      assert.equal(msg.type, 'shipInfo');
      assert.equal(msg.cargoFuel, fuelQty);
      assert.equal(msg.holdsAvailable, merchantCfg.startingHolds - fuelQty);
    } finally {
      await closeWS(ws);
    }
  });
});

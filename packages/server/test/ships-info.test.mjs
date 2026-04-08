import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectWS as _connectWS, closeWS, wsRequest } from './helpers.mjs';
import { ensureServer, createPool } from './global-setup.mjs';
import { ClientMsgType, ServerMsgType } from '@twnr/shared';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = join(dirname(__filename), '..');

const merchantCfg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'ships', '01-vulpeculan-cruiser.json'), 'utf8'));
const UNIVERSE_ID = 1;

async function navigateTo(ws, targetSector) {
  const disp = await wsRequest(ws, { type: ClientMsgType.SectorDisplay }, ServerMsgType.SectorDisplayResult);
  if (disp.sector === targetSector) return;
  const path = await wsRequest(ws, { type: ClientMsgType.ShortestPath, from: disp.sector, to: targetSector }, ServerMsgType.ShortestPathResult);
  if (path.type === ServerMsgType.Error) throw new Error(`No path to ${targetSector}`);
  for (let i = 1; i < path.path.length; i++) {
    await wsRequest(ws, { type: ClientMsgType.Move, sector: path.path[i] }, ServerMsgType.MoveResult);
  }
}

// ─── globals ──────────────────────────────────────────────────────────────────

let pool;

function connectWS(opts = {}) {
  return _connectWS({ pool, universeId: UNIVERSE_ID, ...opts });
}

// ─── setup ────────────────────────────────────────────────────────────────────

before(async () => {
  await ensureServer();
  pool = createPool();
});

after(async () => {
  if (pool) await pool.end();
});

// ─── tests ────────────────────────────────────────────────────────────────────

describe('Ship info query', () => {
  it('returns all required fields for a new player', async () => {
    const { ws } = await connectWS();
    try {
      const msg = await wsRequest(ws, { type: ClientMsgType.ShipInfo }, ServerMsgType.ShipInfoResult);
      assert.equal(msg.type, ServerMsgType.ShipInfoResult);
      assert.equal(typeof msg.playerId, 'number');
      assert.equal(typeof msg.shipName, 'string');
      assert.equal(typeof msg.drones, 'number');
      assert.equal(typeof msg.shields, 'number');
      assert.equal(typeof msg.maxDrones, 'number');
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

  it('returns correct values for a new Vulpeculan Cruiser player', async () => {
    const { ws } = await connectWS();
    try {
      const msg = await wsRequest(ws, { type: ClientMsgType.ShipInfo }, ServerMsgType.ShipInfoResult);
      assert.equal(msg.type, ServerMsgType.ShipInfoResult);
      assert.equal(msg.shipName, merchantCfg.name);
      assert.equal(msg.drones, 0);
      assert.equal(msg.shields, 0);
      assert.equal(msg.maxDrones, merchantCfg.maxDrones);
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
  it('cargoLimit reflects holds after buying holds', async () => {
    const { ws } = await connectWS();
    const qty = 4;
    try {
      await wsRequest(ws, { type: ClientMsgType.BuyHolds, quantity: qty }, ServerMsgType.BuyHoldsResult);
      const msg = await wsRequest(ws, { type: ClientMsgType.ShipInfo }, ServerMsgType.ShipInfoResult);
      assert.equal(msg.type, ServerMsgType.ShipInfoResult);
      assert.equal(msg.cargoLimit, merchantCfg.startingHolds + qty);
    } finally {
      await closeWS(ws);
    }
  });

  it('holdsAvailable reflects actual cargo (not just cargoLimit)', async () => {
    const fuelRes = await pool.query('SELECT s.sector_number AS sector_id FROM ports p JOIN sectors s ON p.sector_id = s.id WHERE p.class IN (3,4,6,7) AND s.universe_id = $1 LIMIT 1', [UNIVERSE_ID]);
    assert.ok(fuelRes.rows.length > 0, 'Need a fuel-selling sector');
    const fuelSector = Number(fuelRes.rows[0].sector_id);

    const { ws } = await connectWS();
    const fuelQty = 3;
    try {
      await navigateTo(ws, fuelSector);
      await wsRequest(ws, { type: ClientMsgType.PortTransaction, good: 'fuel', quantity: fuelQty, action: 'buy' }, ServerMsgType.PortTransactionResult);

      const msg = await wsRequest(ws, { type: ClientMsgType.ShipInfo }, ServerMsgType.ShipInfoResult);
      assert.equal(msg.type, ServerMsgType.ShipInfoResult);
      assert.equal(msg.cargoFuel, fuelQty);
      assert.equal(msg.holdsAvailable, merchantCfg.startingHolds - fuelQty);
    } finally {
      await closeWS(ws);
    }
  });
});

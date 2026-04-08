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
const escapePodCfg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'ships', '00-escape-pod.json'), 'utf8'));
const STARTING_CREDITS = 10000;
const DRONE_PRICE = 20;
const SHIELD_PRICE  = 10;
const HOLD_PRICE    = 50;
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

async function findFuelSellerSector() {
  const res = await pool.query('SELECT s.sector_number AS sector_id FROM ports p JOIN sectors s ON p.sector_id = s.id WHERE p.class IN (3, 4, 6, 7) AND s.universe_id = $1 LIMIT 1', [UNIVERSE_ID]);
  return res.rows.length > 0 ? Number(res.rows[0].sector_id) : null;
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

describe('Buy equipment — success', () => {
  it('buy-drones deducts 20 credits per drone and increases drone count', async () => {
    const { ws } = await connectWS();
    const qty = 3;
    try {
      const msg = await wsRequest(ws, { type: ClientMsgType.BuyDrones, quantity: qty }, ServerMsgType.BuyDronesResult);
      assert.equal(msg.type, ServerMsgType.BuyDronesResult);
      assert.equal(msg.drones, qty);
      assert.equal(msg.credits, STARTING_CREDITS - qty * DRONE_PRICE);
    } finally {
      await closeWS(ws);
    }
  });

  it('buy-shields deducts 10 credits per shield and increases shield count', async () => {
    const { ws } = await connectWS();
    const qty = 5;
    try {
      const msg = await wsRequest(ws, { type: ClientMsgType.BuyShields, quantity: qty }, ServerMsgType.BuyShieldsResult);
      assert.equal(msg.type, ServerMsgType.BuyShieldsResult);
      assert.equal(msg.shields, qty);
      assert.equal(msg.credits, STARTING_CREDITS - qty * SHIELD_PRICE);
    } finally {
      await closeWS(ws);
    }
  });

  it('buy-holds deducts 50 credits per hold and increases cargoLimit', async () => {
    const { ws } = await connectWS();
    const qty = 3;
    try {
      const msg = await wsRequest(ws, { type: ClientMsgType.BuyHolds, quantity: qty }, ServerMsgType.BuyHoldsResult);
      assert.equal(msg.type, ServerMsgType.BuyHoldsResult);
      assert.equal(msg.cargoLimit, merchantCfg.startingHolds + qty);
      assert.equal(msg.credits, STARTING_CREDITS - qty * HOLD_PRICE);
    } finally {
      await closeWS(ws);
    }
  });

  it('cumulative drone purchases respect maxDrones cap', async () => {
    const { ws } = await connectWS();
    const firstBuy = merchantCfg.maxDrones - 2;
    try {
      // Buy maxDrones-2 drones first
      await wsRequest(ws, { type: ClientMsgType.BuyDrones, quantity: firstBuy }, ServerMsgType.BuyDronesResult);
      // Then try to buy 3 more — would exceed cap by 1
      const msg = await wsRequest(ws, { type: ClientMsgType.BuyDrones, quantity: 3 }, ServerMsgType.BuyDronesResult);
      assert.equal(msg.type, ServerMsgType.Error);
      assert.equal(msg.message, 'Exceeds maximum');
    } finally {
      await closeWS(ws);
    }
  });

  it('cumulative shield purchases respect maxShields cap', async () => {
    const { ws } = await connectWS();
    const firstBuy = merchantCfg.maxShields - 2;
    try {
      await wsRequest(ws, { type: ClientMsgType.BuyShields, quantity: firstBuy }, ServerMsgType.BuyShieldsResult);
      const msg = await wsRequest(ws, { type: ClientMsgType.BuyShields, quantity: 3 }, ServerMsgType.BuyShieldsResult);
      assert.equal(msg.type, ServerMsgType.Error);
      assert.equal(msg.message, 'Exceeds maximum');
    } finally {
      await closeWS(ws);
    }
  });

  it('buy-holds cap is enforced using the current ship type (Escape Pod has lower maxHolds)', async () => {
    const starbaseRes = await pool.query(`SELECT sector_number FROM sectors WHERE name = 'Starbase' AND universe_id = $1`, [UNIVERSE_ID]);
    assert.ok(starbaseRes.rows.length > 0, 'Starbase must exist');
    const starbaseId = Number(starbaseRes.rows[0].sector_number);

    const { ws, welcome } = await connectWS();
    try {
      // Exchange to Escape Pod at Starbase (navigate there first)
      await navigateTo(ws, starbaseId);
      const exchMsg = await wsRequest(ws, { type: ClientMsgType.BuyShipTradein, targetShipName: escapePodCfg.name }, ServerMsgType.BuyShipTradeinResult);
      assert.equal(exchMsg.type, ServerMsgType.BuyShipTradeinResult);

      // Teleport to sector 1 (class 0 port) via DB — buyHolds reads current_sector_id from DB
      await pool.query(`UPDATE players SET current_sector_id = (SELECT id FROM sectors WHERE sector_number = 1 AND universe_id = ${UNIVERSE_ID}) WHERE id = $1`, [welcome.playerId]);

      // Trying to buy maxHolds - startingHolds + 1 holds should fail
      const overLimit = escapePodCfg.maxHolds - escapePodCfg.startingHolds + 1;
      const msg = await wsRequest(ws, { type: ClientMsgType.BuyHolds, quantity: overLimit }, ServerMsgType.BuyHoldsResult);
      assert.equal(msg.type, ServerMsgType.Error);
      assert.equal(msg.message, 'Exceeds maximum');
    } finally {
      await closeWS(ws);
    }
  });

  it('buy-holds returns "Exceeds maximum" when purchase would exceed maxHolds cap', async () => {
    const { ws } = await connectWS();
    try {
      // one more than the room available
      const msg = await wsRequest(ws, { type: ClientMsgType.BuyHolds, quantity: merchantCfg.maxHolds - merchantCfg.startingHolds + 1 }, ServerMsgType.BuyHoldsResult);
      assert.equal(msg.type, ServerMsgType.Error);
      assert.equal(msg.message, 'Exceeds maximum');
    } finally {
      await closeWS(ws);
    }
  });

  it('buy-holds succeeds when purchase reaches exactly maxHolds cap', async () => {
    const { ws } = await connectWS();
    try {
      const qty = merchantCfg.maxHolds - merchantCfg.startingHolds;
      const msg = await wsRequest(ws, { type: ClientMsgType.BuyHolds, quantity: qty }, ServerMsgType.BuyHoldsResult);
      assert.equal(msg.type, ServerMsgType.BuyHoldsResult, 'buying exactly up to maxHolds should succeed');
      assert.equal(msg.cargoLimit, merchantCfg.maxHolds);
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
      await pool.query('UPDATE ships SET fuel = 2, organics = 2 WHERE id = (SELECT ship_id FROM players WHERE id = $1)', [playerId]);
      await navigateTo(ws, fuelSector);
      // Buying 2 more fuel: 2+2+2 = 6 > cargoLimit(5) — should fail
      const msg = await wsRequest(ws, { type: ClientMsgType.PortTransaction, good: 'fuel', quantity: 2, action: 'buy' }, ServerMsgType.PortTransactionResult);
      assert.equal(msg.type, ServerMsgType.Error);
      assert.equal(msg.message, 'Insufficient cargo holds');
    } finally {
      await closeWS(ws);
    }
  });

  it('cargo limit is enforced after ship exchange reduces cargoLimit', async () => {
    const fuelSector = await findFuelSellerSector();
    assert.ok(fuelSector, 'Need a fuel-selling port for this test');
    const starbaseRes = await pool.query(`SELECT sector_number FROM sectors WHERE name = 'Starbase' AND universe_id = $1`, [UNIVERSE_ID]);
    assert.ok(starbaseRes.rows.length > 0, 'Starbase must exist');
    const starbaseId = Number(starbaseRes.rows[0].sector_number);

    const { ws } = await connectWS();
    try {
      // Navigate to Starbase and exchange to Escape Pod (startingHolds=1)
      await navigateTo(ws, starbaseId);
      const exchMsg = await wsRequest(ws, { type: ClientMsgType.BuyShipTradein, targetShipName: escapePodCfg.name }, ServerMsgType.BuyShipTradeinResult);
      assert.equal(exchMsg.type, ServerMsgType.BuyShipTradeinResult);

      // Navigate to fuel port and try to buy 2 fuel — exceeds new cargoLimit of 1
      await navigateTo(ws, fuelSector);
      const msg = await wsRequest(ws, { type: ClientMsgType.PortTransaction, good: 'fuel', quantity: 2, action: 'buy' }, ServerMsgType.PortTransactionResult);
      assert.equal(msg.type, ServerMsgType.Error);
      assert.equal(msg.message, 'Insufficient cargo holds');
    } finally {
      await closeWS(ws);
    }
  });

  it('after buying holds the new holds value is enforced in trade', async () => {
    const fuelRes = await pool.query('SELECT s.sector_number AS sector_id FROM ports p JOIN sectors s ON p.sector_id = s.id WHERE p.class IN (3,4,6,7) AND s.universe_id = $1 LIMIT 1', [UNIVERSE_ID]);
    assert.ok(fuelRes.rows.length > 0, 'Need a fuel-selling sector');
    const fuelSector = Number(fuelRes.rows[0].sector_id);

    const { ws } = await connectWS();
    try {
      // Buy 3 holds → holds becomes 8
      const buyMsg = await wsRequest(ws, { type: ClientMsgType.BuyHolds, quantity: 3 }, ServerMsgType.BuyHoldsResult);
      assert.equal(buyMsg.type, ServerMsgType.BuyHoldsResult);

      // Navigate to fuel seller and buy 8 units (should succeed now)
      await navigateTo(ws, fuelSector);
      const msg = await wsRequest(ws, { type: ClientMsgType.PortTransaction, good: 'fuel', quantity: 8, action: 'buy' }, ServerMsgType.PortTransactionResult);
      assert.equal(msg.type, ServerMsgType.PortTransactionResult, 'should be able to buy 8 fuel after buying 3 extra holds');
    } finally {
      await closeWS(ws);
    }
  });
});

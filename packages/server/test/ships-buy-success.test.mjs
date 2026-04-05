import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectWS as _connectWS, closeWS, wsRequest } from './helpers.mjs';
import { ensureServer, createPool } from './global-setup.mjs';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = join(dirname(__filename), '..');

const merchantCfg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'ships', 'merchant.json'), 'utf8'));
const warbirdCfg  = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'ships', 'warbird.json'),  'utf8'));
const STARTING_CREDITS = 10000;
const FIGHTER_PRICE = 20;
const SHIELD_PRICE  = 10;
const HOLD_PRICE    = 50;
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

function connectWS(opts = {}) {
  return _connectWS({ pool, universeId: UNIVERSE_ID, ...opts });
}

async function findFuelSellerSector() {
  const res = await pool.query('SELECT sector_id FROM ports WHERE class IN (3, 4, 6, 7) AND universe_id = $1 LIMIT 1', [UNIVERSE_ID]);
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
  it('buy-fighters deducts 20 credits per fighter and increases fighter count', async () => {
    const { ws } = await connectWS();
    const qty = 3;
    try {
      const msg = await wsRequest(ws, { type: 'buyFighters', quantity: qty }, 'buyResult');
      assert.equal(msg.type, 'buyResult');
      assert.equal(msg.fighters, qty);
      assert.equal(msg.credits, STARTING_CREDITS - qty * FIGHTER_PRICE);
      assert.ok('shields' in msg, 'response must include shields');
      assert.ok('cargoLimit' in msg, 'response must include cargoLimit');
    } finally {
      await closeWS(ws);
    }
  });

  it('buy-shields deducts 10 credits per shield and increases shield count', async () => {
    const { ws } = await connectWS();
    const qty = 5;
    try {
      const msg = await wsRequest(ws, { type: 'buyShields', quantity: qty }, 'buyResult');
      assert.equal(msg.type, 'buyResult');
      assert.equal(msg.shields, qty);
      assert.equal(msg.credits, STARTING_CREDITS - qty * SHIELD_PRICE);
      assert.ok('fighters' in msg, 'response must include fighters');
      assert.ok('cargoLimit' in msg, 'response must include cargoLimit');
    } finally {
      await closeWS(ws);
    }
  });

  it('buy-holds deducts 50 credits per hold and increases cargoLimit', async () => {
    const { ws } = await connectWS();
    const qty = 3;
    try {
      const msg = await wsRequest(ws, { type: 'buyHolds', quantity: qty }, 'buyResult');
      assert.equal(msg.type, 'buyResult');
      assert.equal(msg.cargoLimit, merchantCfg.startingHolds + qty);
      assert.equal(msg.credits, STARTING_CREDITS - qty * HOLD_PRICE);
      assert.ok('fighters' in msg, 'response must include fighters');
      assert.ok('shields' in msg, 'response must include shields');
    } finally {
      await closeWS(ws);
    }
  });

  it('cumulative fighter purchases respect maxFighters cap', async () => {
    const { ws } = await connectWS();
    const firstBuy = merchantCfg.maxFighters - 2;
    try {
      // Buy maxFighters-2 fighters first
      await wsRequest(ws, { type: 'buyFighters', quantity: firstBuy }, 'buyResult');
      // Then try to buy 3 more — would exceed cap by 1
      const msg = await wsRequest(ws, { type: 'buyFighters', quantity: 3 }, 'buyResult');
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'Exceeds maximum');
    } finally {
      await closeWS(ws);
    }
  });

  it('cumulative shield purchases respect maxShields cap', async () => {
    const { ws } = await connectWS();
    const firstBuy = merchantCfg.maxShields - 2;
    try {
      await wsRequest(ws, { type: 'buyShields', quantity: firstBuy }, 'buyResult');
      const msg = await wsRequest(ws, { type: 'buyShields', quantity: 3 }, 'buyResult');
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'Exceeds maximum');
    } finally {
      await closeWS(ws);
    }
  });

  it('buy-holds cap is enforced using the current ship type (Warbird has lower maxHolds)', async () => {
    const stardockRes = await pool.query(`SELECT id FROM sectors WHERE name = 'Stardock' AND universe_id = $1`, [UNIVERSE_ID]);
    assert.ok(stardockRes.rows.length > 0, 'Stardock must exist');
    const stardockId = Number(stardockRes.rows[0].id);

    const { ws, welcome } = await connectWS();
    try {
      // Exchange to Warbird at Stardock (navigate there first)
      await navigateTo(ws, stardockId);
      const exchMsg = await wsRequest(ws, { type: 'shipExchange', targetShipName: warbirdCfg.name }, 'shipExchangeResult');
      assert.equal(exchMsg.type, 'shipExchangeResult');

      // Teleport to sector 1 (class 0 port) via DB — buyHolds reads current_sector from DB
      await pool.query('UPDATE players SET current_sector = 1 WHERE id = $1', [welcome.playerId]);

      // Trying to buy maxHolds - startingHolds + 1 holds should fail
      const overLimit = warbirdCfg.maxHolds - warbirdCfg.startingHolds + 1;
      const msg = await wsRequest(ws, { type: 'buyHolds', quantity: overLimit }, 'buyResult');
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'Exceeds maximum');
    } finally {
      await closeWS(ws);
    }
  });

  it('buy-holds returns "Exceeds maximum" when purchase would exceed maxHolds cap', async () => {
    const { ws } = await connectWS();
    try {
      // one more than the room available
      const msg = await wsRequest(ws, { type: 'buyHolds', quantity: merchantCfg.maxHolds - merchantCfg.startingHolds + 1 }, 'buyResult');
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'Exceeds maximum');
    } finally {
      await closeWS(ws);
    }
  });

  it('buy-holds succeeds when purchase reaches exactly maxHolds cap', async () => {
    const { ws } = await connectWS();
    try {
      const qty = merchantCfg.maxHolds - merchantCfg.startingHolds;
      const msg = await wsRequest(ws, { type: 'buyHolds', quantity: qty }, 'buyResult');
      assert.equal(msg.type, 'buyResult', 'buying exactly up to maxHolds should succeed');
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
      await pool.query('UPDATE ship_cargo SET fuel = 2, organics = 2 WHERE player_id = $1', [playerId]);
      await navigateTo(ws, fuelSector);
      // Buying 2 more fuel: 2+2+2 = 6 > cargoLimit(5) — should fail
      const msg = await wsRequest(ws, { type: 'portTransaction', good: 'fuel', quantity: 2, action: 'buy' }, 'portTransactionResult');
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'Insufficient cargo holds');
    } finally {
      await closeWS(ws);
    }
  });

  it('cargo limit is enforced after ship exchange reduces cargoLimit', async () => {
    const fuelSector = await findFuelSellerSector();
    assert.ok(fuelSector, 'Need a fuel-selling port for this test');
    const stardockRes = await pool.query(`SELECT id FROM sectors WHERE name = 'Stardock' AND universe_id = $1`, [UNIVERSE_ID]);
    assert.ok(stardockRes.rows.length > 0, 'Stardock must exist');
    const stardockId = Number(stardockRes.rows[0].id);

    const { ws } = await connectWS();
    try {
      // Navigate to Stardock and exchange to Warbird (startingHolds=1)
      await navigateTo(ws, stardockId);
      const exchMsg = await wsRequest(ws, { type: 'shipExchange', targetShipName: warbirdCfg.name }, 'shipExchangeResult');
      assert.equal(exchMsg.type, 'shipExchangeResult');

      // Navigate to fuel port and try to buy 2 fuel — exceeds new cargoLimit of 1
      await navigateTo(ws, fuelSector);
      const msg = await wsRequest(ws, { type: 'portTransaction', good: 'fuel', quantity: 2, action: 'buy' }, 'portTransactionResult');
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'Insufficient cargo holds');
    } finally {
      await closeWS(ws);
    }
  });

  it('after buying holds the new cargo_limit is enforced in trade', async () => {
    const fuelRes = await pool.query('SELECT sector_id FROM ports WHERE class IN (3,4,6,7) AND universe_id = $1 LIMIT 1', [UNIVERSE_ID]);
    assert.ok(fuelRes.rows.length > 0, 'Need a fuel-selling sector');
    const fuelSector = Number(fuelRes.rows[0].sector_id);

    const { ws } = await connectWS();
    try {
      // Buy 3 holds → cargo_limit becomes 8
      const buyMsg = await wsRequest(ws, { type: 'buyHolds', quantity: 3 }, 'buyResult');
      assert.equal(buyMsg.type, 'buyResult');

      // Navigate to fuel seller and buy 8 units (should succeed now)
      await navigateTo(ws, fuelSector);
      const msg = await wsRequest(ws, { type: 'portTransaction', good: 'fuel', quantity: 8, action: 'buy' }, 'portTransactionResult');
      assert.equal(msg.type, 'portTransactionResult', 'should be able to buy 8 fuel after buying 3 extra holds');
    } finally {
      await closeWS(ws);
    }
  });
});

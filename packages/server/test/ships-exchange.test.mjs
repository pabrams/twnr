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

const merchantCfg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'ships', 'merchant.json'), 'utf8'));
const warbirdCfg  = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'ships', 'warbird.json'),  'utf8'));
const STARTING_CREDITS = 10000;
const UNIVERSE_ID = 1;

async function navigateTo(ws, targetSector) {
  const disp = await wsRequest(ws, { type: 'sectorDisplay' }, 'sectorDisplayResult');
  if (disp.sector === targetSector) return;
  const path = await wsRequest(ws, { type: ClientMsgType.ShortestPath, from: disp.sector, to: targetSector }, ServerMsgType.ShortestPathResult);
  if (path.type === 'error') throw new Error(`No path to ${targetSector}`);
  for (let i = 1; i < path.path.length; i++) {
    await wsRequest(ws, { type: 'move', sector: path.path[i] }, 'moveResult');
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

describe('Ship exchange — validation', () => {
  async function getStardockSector() {
    const res = await pool.query(`SELECT id FROM sectors WHERE name = 'Stardock' AND universe_id = $1`, [UNIVERSE_ID]);
    return res.rows.length > 0 ? Number(res.rows[0].id) : null;
  }

  it('returns "Not at Stardock" when player is not in Stardock', async () => {
    const { ws } = await connectWS();
    try {
      const msg = await wsRequest(ws, { type: ClientMsgType.BuyShipTradein, targetShipName: warbirdCfg.name }, ServerMsgType.BuyShipTradeinResult);
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'Not at Stardock');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns "Unknown ship" for an unrecognized ship name', async () => {
    const stardockId = await getStardockSector();
    assert.ok(stardockId, 'Stardock sector must exist');

    const { ws } = await connectWS();
    try {
      await navigateTo(ws, stardockId);
      const msg = await wsRequest(ws, { type: ClientMsgType.BuyShipTradein, targetShipName: 'Galaxy Hauler' }, ServerMsgType.BuyShipTradeinResult);
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'Unknown ship');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns "Already on that ship" when targeting the current ship', async () => {
    const stardockId = await getStardockSector();
    assert.ok(stardockId);

    const { ws } = await connectWS();
    try {
      await navigateTo(ws, stardockId);
      const msg = await wsRequest(ws, { type: ClientMsgType.BuyShipTradein, targetShipName: merchantCfg.name }, ServerMsgType.BuyShipTradeinResult);
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'Already on that ship');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns "Insufficient credits" when player cannot afford the upgrade', async () => {
    const stardockId = await getStardockSector();
    assert.ok(stardockId);

    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      await navigateTo(ws, stardockId);
      const upgradeCost = warbirdCfg.price - merchantCfg.price;
      await pool.query('UPDATE ship_cargo SET credits = $1 WHERE player_id = $2', [upgradeCost - 1, playerId]);
      const msg = await wsRequest(ws, { type: ClientMsgType.BuyShipTradein, targetShipName: warbirdCfg.name }, ServerMsgType.BuyShipTradeinResult);
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'Insufficient credits');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns "New ship has insufficient holds for current cargo" when cargo exceeds new ship startingHolds', async () => {
    const stardockId = await getStardockSector();
    assert.ok(stardockId);

    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      // set fuel > warbird's startingHolds directly in ship_cargo to trigger the holds check on exchange
      await pool.query('UPDATE ship_cargo SET fuel = $1 WHERE player_id = $2', [warbirdCfg.startingHolds + 1, playerId]);

      await navigateTo(ws, stardockId);
      const msg = await wsRequest(ws, { type: ClientMsgType.BuyShipTradein, targetShipName: warbirdCfg.name }, ServerMsgType.BuyShipTradeinResult);
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'New ship has insufficient holds for current cargo');
    } finally {
      await closeWS(ws);
    }
  });
});

describe('Ship exchange — success', () => {
  async function getStardockSector() {
    const res = await pool.query(`SELECT id FROM sectors WHERE name = 'Stardock' AND universe_id = $1`, [UNIVERSE_ID]);
    return res.rows.length > 0 ? Number(res.rows[0].id) : null;
  }

  it('upgrade to Warbird costs correct credits, resets fighters/shields, sets cargoLimit to startingHolds', async () => {
    const stardockId = await getStardockSector();
    assert.ok(stardockId);

    const upgradeCost = warbirdCfg.price - merchantCfg.price;
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      await navigateTo(ws, stardockId);
      const msg = await wsRequest(ws, { type: ClientMsgType.BuyShipTradein, targetShipName: warbirdCfg.name }, ServerMsgType.BuyShipTradeinResult);
      assert.equal(msg.type, ServerMsgType.buyShipTradeinResult);
      assert.equal(msg.shipName, warbirdCfg.name);
      assert.equal(msg.credits, STARTING_CREDITS - upgradeCost);
      assert.equal(msg.maxFighters, warbirdCfg.maxFighters);
      assert.equal(msg.maxShields, warbirdCfg.maxShields);
      assert.equal(msg.cargoLimit, warbirdCfg.startingHolds);

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
      await wsRequest(ws, { type: ClientMsgType.BuyFighters, quantity: Math.min(5, merchantCfg.maxFighters) }, ServerMsgType.BuyFightersResult);
      await wsRequest(ws, { type: ClientMsgType.BuyShields, quantity: Math.min(4, merchantCfg.maxShields) }, ServerMsgType.BuyShieldsResult);

      await navigateTo(ws, stardockId);
      const msg = await wsRequest(ws, { type: ClientMsgType.BuyShipTradein, targetShipName: warbirdCfg.name }, ServerMsgType.BuyShipTradeinResult);
      assert.equal(msg.type, ServerMsgType.buyShipTradeinResult);

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

    const { ws } = await connectWS();
    try {
      await navigateTo(ws, stardockId);
      // Upgrade first
      await wsRequest(ws, { type: ClientMsgType.BuyShipTradein, targetShipName: warbirdCfg.name }, ServerMsgType.BuyShipTradeinResult);
      // Now downgrade
      const msg = await wsRequest(ws, { type: ClientMsgType.BuyShipTradein, targetShipName: merchantCfg.name }, ServerMsgType.BuyShipTradeinResult);
      assert.equal(msg.type, ServerMsgType.buyShipTradeinResult);
      assert.equal(msg.shipName, merchantCfg.name);
      assert.equal(msg.credits, STARTING_CREDITS, 'credits restored after upgrade then downgrade');
      assert.equal(msg.cargoLimit, merchantCfg.startingHolds);
    } finally {
      await closeWS(ws);
    }
  });
});

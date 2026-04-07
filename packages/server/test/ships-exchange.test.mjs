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

describe('Ship exchange — validation', () => {
  async function getStarbaseSector() {
    const res = await pool.query(`SELECT sector_number FROM sectors WHERE name = 'Starbase' AND universe_id = $1`, [UNIVERSE_ID]);
    return res.rows.length > 0 ? Number(res.rows[0].sector_number) : null;
  }

  it('returns "Not at Starbase" when player is not in Starbase', async () => {
    const { ws } = await connectWS();
    try {
      const msg = await wsRequest(ws, { type: ClientMsgType.BuyShipTradein, targetShipName: warbirdCfg.name }, ServerMsgType.BuyShipTradeinResult);
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'Not at Starbase');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns "Unknown ship" for an unrecognized ship name', async () => {
    const starbaseId = await getStarbaseSector();
    assert.ok(starbaseId, 'Starbase sector must exist');

    const { ws } = await connectWS();
    try {
      await navigateTo(ws, starbaseId);
      const msg = await wsRequest(ws, { type: ClientMsgType.BuyShipTradein, targetShipName: 'Galaxy Hauler' }, ServerMsgType.BuyShipTradeinResult);
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'Unknown ship');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns "Already on that ship" when targeting the current ship', async () => {
    const starbaseId = await getStarbaseSector();
    assert.ok(starbaseId);

    const { ws } = await connectWS();
    try {
      await navigateTo(ws, starbaseId);
      const msg = await wsRequest(ws, { type: ClientMsgType.BuyShipTradein, targetShipName: merchantCfg.name }, ServerMsgType.BuyShipTradeinResult);
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'Already on that ship');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns "Insufficient credits" when player cannot afford the upgrade', async () => {
    const starbaseId = await getStarbaseSector();
    assert.ok(starbaseId);

    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      await navigateTo(ws, starbaseId);
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
    const starbaseId = await getStarbaseSector();
    assert.ok(starbaseId);

    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      // set fuel > warbird's startingHolds directly in ship_cargo to trigger the holds check on exchange
      await pool.query('UPDATE ship_cargo SET fuel = $1 WHERE player_id = $2', [warbirdCfg.startingHolds + 1, playerId]);

      await navigateTo(ws, starbaseId);
      const msg = await wsRequest(ws, { type: ClientMsgType.BuyShipTradein, targetShipName: warbirdCfg.name }, ServerMsgType.BuyShipTradeinResult);
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'New ship has insufficient holds for current cargo');
    } finally {
      await closeWS(ws);
    }
  });
});

describe('Ship exchange — success', () => {
  async function getStarbaseSector() {
    const res = await pool.query(`SELECT sector_number FROM sectors WHERE name = 'Starbase' AND universe_id = $1`, [UNIVERSE_ID]);
    return res.rows.length > 0 ? Number(res.rows[0].sector_number) : null;
  }

  it('upgrade to Warbird costs correct credits, resets drones/shields, sets cargoLimit to startingHolds', async () => {
    const starbaseId = await getStarbaseSector();
    assert.ok(starbaseId);

    const upgradeCost = warbirdCfg.price - merchantCfg.price;
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      await navigateTo(ws, starbaseId);
      const msg = await wsRequest(ws, { type: ClientMsgType.BuyShipTradein, targetShipName: warbirdCfg.name }, ServerMsgType.BuyShipTradeinResult);
      assert.equal(msg.type, ServerMsgType.BuyShipTradeinResult);
      assert.equal(msg.shipName, warbirdCfg.name);
      assert.equal(msg.credits, STARTING_CREDITS - upgradeCost);
      assert.equal(msg.maxDrones, warbirdCfg.maxDrones);
      assert.equal(msg.maxShields, warbirdCfg.maxShields);
      assert.equal(msg.cargoLimit, warbirdCfg.startingHolds);

      // Verify DB: drones and shields reset to 0
      const shipRes = await pool.query('SELECT * FROM player_ships WHERE player_id = $1', [playerId]);
      assert.equal(shipRes.rows[0].ship_name, warbirdCfg.name);
      assert.equal(Number(shipRes.rows[0].drones), 0);
      assert.equal(Number(shipRes.rows[0].shields), 0);
      assert.equal(Number(shipRes.rows[0].cargo_limit), warbirdCfg.startingHolds);
    } finally {
      await closeWS(ws);
    }
  });

  it('exchange resets previously purchased drones and shields to 0', async () => {
    const starbaseId = await getStarbaseSector();
    assert.ok(starbaseId);

    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      // Buy some drones and shields first (player starts at sector 1, class 0 port)
      await wsRequest(ws, { type: ClientMsgType.BuyDrones, quantity: Math.min(5, merchantCfg.maxDrones) }, ServerMsgType.BuyDronesResult);
      await wsRequest(ws, { type: ClientMsgType.BuyShields, quantity: Math.min(4, merchantCfg.maxShields) }, ServerMsgType.BuyShieldsResult);

      await navigateTo(ws, starbaseId);
      const msg = await wsRequest(ws, { type: ClientMsgType.BuyShipTradein, targetShipName: warbirdCfg.name }, ServerMsgType.BuyShipTradeinResult);
      assert.equal(msg.type, ServerMsgType.BuyShipTradeinResult);

      const shipRes = await pool.query('SELECT drones, shields FROM player_ships WHERE player_id = $1', [playerId]);
      assert.equal(Number(shipRes.rows[0].drones), 0, 'drones should be reset to 0 on exchange');
      assert.equal(Number(shipRes.rows[0].shields), 0, 'shields should be reset to 0 on exchange');
    } finally {
      await closeWS(ws);
    }
  });

  it('downgrade from Warbird to Merchant Freighter refunds credit difference, sets cargoLimit to startingHolds', async () => {
    const starbaseId = await getStarbaseSector();
    assert.ok(starbaseId);

    const { ws } = await connectWS();
    try {
      await navigateTo(ws, starbaseId);
      // Upgrade first
      await wsRequest(ws, { type: ClientMsgType.BuyShipTradein, targetShipName: warbirdCfg.name }, ServerMsgType.BuyShipTradeinResult);
      // Now downgrade
      const msg = await wsRequest(ws, { type: ClientMsgType.BuyShipTradein, targetShipName: merchantCfg.name }, ServerMsgType.BuyShipTradeinResult);
      assert.equal(msg.type, ServerMsgType.BuyShipTradeinResult);
      assert.equal(msg.shipName, merchantCfg.name);
      assert.equal(msg.credits, STARTING_CREDITS, 'credits restored after upgrade then downgrade');
      assert.equal(msg.cargoLimit, merchantCfg.startingHolds);
    } finally {
      await closeWS(ws);
    }
  });
});

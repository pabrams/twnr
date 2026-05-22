import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectWS as _connectWS, closeWS, wsRequest } from './helpers.mjs';
import { ensureServer, createPool } from './global-setup.mjs';
import { ClientTag, ServerTag } from '@twnr/shared';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = join(dirname(__filename), '..');

const merchantCfg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'templates', 'stock', 'ships', '01-vulpeculan-cruiser.json'), 'utf8'));
const warbirdCfg  = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'templates', 'stock', 'ships', '02-hydra-skiff.json'),  'utf8'));
const tugCfg      = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'templates', 'stock', 'ships', '11-purveyor-tug.json'),  'utf8'));
const shipPrice = (cfg) => cfg.costDrive + cfg.costComputer + cfg.costHull + cfg.startingHolds * cfg.holdCost;
const STARTING_CREDITS = 10000;
const UNIVERSE_ID = 1;

async function navigateTo(ws, targetSector) {
  const disp = await wsRequest(ws, { type: ClientTag.SectorDisplay }, ServerTag.SectorDisplayResult);
  if (disp.sector === targetSector) return;
  const path = await wsRequest(ws, { type: ClientTag.ShortestPath, from: disp.sector, to: targetSector }, ServerTag.ShortestPathResult);
  if (path.type === ServerTag.Error) throw new Error(`No path to ${targetSector}`);
  for (let i = 1; i < path.path.length; i++) {
    await wsRequest(ws, { type: ClientTag.Move, sector: path.path[i].sector }, ServerTag.MoveResult);
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
      const msg = await wsRequest(ws, { type: ClientTag.BuyShipTradein, targetShipName: warbirdCfg.name }, ServerTag.BuyShipTradeinResult);
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
      await wsRequest(ws, { type: ClientTag.DockStarbase }, ServerTag.DockStarbaseResult);
      const msg = await wsRequest(ws, { type: ClientTag.BuyShipTradein, targetShipName: 'Galaxy Hauler' }, ServerTag.BuyShipTradeinResult);
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
      await wsRequest(ws, { type: ClientTag.DockStarbase }, ServerTag.DockStarbaseResult);
      const msg = await wsRequest(ws, { type: ClientTag.BuyShipTradein, targetShipName: merchantCfg.name }, ServerTag.BuyShipTradeinResult);
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
      await wsRequest(ws, { type: ClientTag.DockStarbase }, ServerTag.DockStarbaseResult);
      // Torpedo Boat costs more than Vulpeculan Cruiser, so this is a real upgrade
      const upgradeCost = shipPrice(tugCfg) - shipPrice(merchantCfg);
      assert.ok(upgradeCost > 0, 'Purveyor Tug should cost more than Vulpeculan Cruiser');
      await pool.query('UPDATE players SET credits = $1 WHERE id = $2', [upgradeCost - 1, playerId]);
      const msg = await wsRequest(ws, { type: ClientTag.BuyShipTradein, targetShipName: tugCfg.name }, ServerTag.BuyShipTradeinResult);
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'Insufficient credits');
    } finally {
      await closeWS(ws);
    }
  });

  // Trade-in no longer checks cargo (cargo is discarded with old ship)
});

describe('Ship exchange — success', () => {
  async function getStarbaseSector() {
    const res = await pool.query(`SELECT sector_number FROM sectors WHERE name = 'Starbase' AND universe_id = $1`, [UNIVERSE_ID]);
    return res.rows.length > 0 ? Number(res.rows[0].sector_number) : null;
  }

  it('upgrade to Hydra Skiff costs correct credits, resets drones/shields, sets cargoLimit to startingHolds', async () => {
    const starbaseId = await getStarbaseSector();
    assert.ok(starbaseId);

    const upgradeCost = shipPrice(warbirdCfg) - shipPrice(merchantCfg);
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      await navigateTo(ws, starbaseId);
      await wsRequest(ws, { type: ClientTag.DockStarbase }, ServerTag.DockStarbaseResult);
      const msg = await wsRequest(ws, { type: ClientTag.BuyShipTradein, targetShipName: warbirdCfg.name }, ServerTag.BuyShipTradeinResult);
      assert.equal(msg.type, ServerTag.BuyShipTradeinResult);
      assert.equal(msg.shipName, warbirdCfg.name);
      assert.equal(msg.credits, STARTING_CREDITS - upgradeCost);
      assert.equal(msg.maxDrones, warbirdCfg.maxDrones);
      assert.equal(msg.maxShields, warbirdCfg.maxShields);
      assert.equal(msg.cargoLimit, warbirdCfg.startingHolds);

      // Verify DB: drones and shields reset to 0
      const shipRes = await pool.query('SELECT s.*, st.name as ship_name FROM ships s JOIN ship_types st ON s.ship_type_id = st.id WHERE s.id = (SELECT ship_id FROM players WHERE id = $1)', [playerId]);
      assert.equal(shipRes.rows[0].ship_name, warbirdCfg.name);
      assert.equal(Number(shipRes.rows[0].drones), 0);
      assert.equal(Number(shipRes.rows[0].shields), 0);
      assert.equal(Number(shipRes.rows[0].holds), warbirdCfg.startingHolds);
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
      await wsRequest(ws, { type: ClientTag.BuyDrones, quantity: Math.min(5, merchantCfg.maxDrones) }, ServerTag.BuyDronesResult);
      await wsRequest(ws, { type: ClientTag.BuyShields, quantity: Math.min(4, merchantCfg.maxShields) }, ServerTag.BuyShieldsResult);

      await navigateTo(ws, starbaseId);
      await wsRequest(ws, { type: ClientTag.DockStarbase }, ServerTag.DockStarbaseResult);
      const msg = await wsRequest(ws, { type: ClientTag.BuyShipTradein, targetShipName: warbirdCfg.name }, ServerTag.BuyShipTradeinResult);
      assert.equal(msg.type, ServerTag.BuyShipTradeinResult);

      const shipRes = await pool.query('SELECT drones, shields FROM ships WHERE id = (SELECT ship_id FROM players WHERE id = $1)', [playerId]);
      assert.equal(Number(shipRes.rows[0].drones), 0, 'drones should be reset to 0 on exchange');
      assert.equal(Number(shipRes.rows[0].shields), 0, 'shields should be reset to 0 on exchange');
    } finally {
      await closeWS(ws);
    }
  });

  it('downgrade from Hydra Skiff to Vulpeculan Cruiser refunds credit difference, sets cargoLimit to startingHolds', async () => {
    const starbaseId = await getStarbaseSector();
    assert.ok(starbaseId);

    const { ws } = await connectWS();
    try {
      await navigateTo(ws, starbaseId);
      await wsRequest(ws, { type: ClientTag.DockStarbase }, ServerTag.DockStarbaseResult);
      // Upgrade first
      await wsRequest(ws, { type: ClientTag.BuyShipTradein, targetShipName: warbirdCfg.name }, ServerTag.BuyShipTradeinResult);
      // Now downgrade
      const msg = await wsRequest(ws, { type: ClientTag.BuyShipTradein, targetShipName: merchantCfg.name }, ServerTag.BuyShipTradeinResult);
      assert.equal(msg.type, ServerTag.BuyShipTradeinResult);
      assert.equal(msg.shipName, merchantCfg.name);
      assert.equal(msg.credits, STARTING_CREDITS, 'credits restored after upgrade then downgrade');
      assert.equal(msg.cargoLimit, merchantCfg.startingHolds);
    } finally {
      await closeWS(ws);
    }
  });
});

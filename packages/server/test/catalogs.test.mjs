import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { ClientTag, ServerTag, HOLD_COST_INCREMENT } from '@twnr/shared';
import { createTestUser, createTestPlayer, connectWS, closeWS, wsRequest } from './helpers.mjs';
import { ensureServer, createPool } from './global-setup.mjs';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = join(dirname(__filename), '..');
const STOCK_DIR = join(PROJECT_ROOT, 'config', 'templates', 'stock');

const UNIVERSE_ID = 1;
const STARTER_SLUG = JSON.parse(
  readFileSync(join(STOCK_DIR, 'ships', '01-vulpeculan-cruiser.json'), 'utf8'),
).slug;

let pool;

async function createPlayer(name, sector = 1) {
  const { userId, token } = await createTestUser(pool);
  const playerId = await createTestPlayer(pool, userId, UNIVERSE_ID, name, sector);
  return { id: playerId, token };
}

async function connectPlayer(token) {
  const conn = await connectWS({ token, universeId: UNIVERSE_ID });
  await conn.ready;
  return conn;
}

function loadStockJson(...segments) {
  return JSON.parse(readFileSync(join(STOCK_DIR, ...segments), 'utf8'));
}

before(async () => {
  await ensureServer();
  pool = createPool();
});

after(async () => {
  if (pool) await pool.end();
});

describe('ShipCatalog', () => {
  it('returns every ship type in the universe with hardware maxima', async () => {
    const p = await createPlayer('catalog_ships');
    const { ws } = await connectPlayer(p.token);
    try {
      const res = await wsRequest(ws, { type: ClientTag.ShipCatalog }, ServerTag.ShipCatalogResult);
      assert.equal(res.type, ServerTag.ShipCatalogResult);

      const dbCount = await pool.query(
        'SELECT COUNT(*)::int AS n FROM universe_ship_types WHERE universe_id = $1',
        [UNIVERSE_ID],
      );
      assert.equal(res.ships.length, dbCount.rows[0].n);

      const cfg = loadStockJson('ships', '01-vulpeculan-cruiser.json');
      const cruiser = res.ships.find((s) => s.name === cfg.slug);
      assert.ok(cruiser, 'starter ship present in catalog');
      assert.equal(cruiser.displayName, cfg.displayName ?? null);
      assert.equal(cruiser.startingHolds, cfg.startingHolds);
      assert.equal(cruiser.maxHolds, cfg.maxHolds);
      assert.equal(cruiser.costDrive, cfg.costDrive);
      assert.equal(
        cruiser.baseCost,
        cfg.costDrive + cfg.costComputer + cfg.costHull + cfg.startingHolds * cfg.holdCost,
      );
      assert.equal(cruiser.hardware.buoy, cfg.maxBuoy);
      assert.equal(cruiser.hardware.hyperspace_1 ?? 0, cfg.canHaveHyperspace1 ? 1 : 0);
    } finally {
      await closeWS(ws);
    }
  });

  it('catalog names are valid BuyShipNew targets', async () => {
    const p = await createPlayer('catalog_ships_buy');
    const { ws } = await connectPlayer(p.token);
    try {
      const res = await wsRequest(ws, { type: ClientTag.ShipCatalog }, ServerTag.ShipCatalogResult);
      const target = res.ships.find((s) => s.name !== STARTER_SLUG && s.baseCost > 0);
      const buy = await wsRequest(
        ws,
        { type: ClientTag.BuyShipNew, targetShipName: target.name },
        ServerTag.ShipNameRequired,
      );
      assert.equal(buy.type, ServerTag.Error);
      assert.equal(buy.message, 'Not at Starbase');
    } finally {
      await closeWS(ws);
    }
  });
});

describe('PlanetCatalog', () => {
  it('returns every planet type in the universe in config shape', async () => {
    const p = await createPlayer('catalog_planets');
    const { ws } = await connectPlayer(p.token);
    try {
      const res = await wsRequest(
        ws,
        { type: ClientTag.PlanetCatalog },
        ServerTag.PlanetCatalogResult,
      );
      assert.equal(res.type, ServerTag.PlanetCatalogResult);

      const stockFiles = readdirSync(join(STOCK_DIR, 'planets')).filter((f) => f.endsWith('.json'));
      assert.equal(res.planets.length, stockFiles.length);

      const terran = loadStockJson('planets', 'terran.json');
      const wire = res.planets.find((pl) => pl.slug === terran.slug);
      assert.ok(wire, 'terran planet type present');
      assert.equal(wire.displayName, terran.displayName ?? null);
      assert.equal(wire.description, terran.description);
      assert.equal(wire.class, terran.class);
      assert.equal(wire.maxFuelColos, terran.maxFuelColos);
      assert.equal(wire.fuelProduction, terran.fuelProduction);
      assert.equal(wire.figFactorEqu, terran.figFactorEqu);
    } finally {
      await closeWS(ws);
    }
  });
});

describe('HardwareCatalog', () => {
  it('returns every hardware item with label and kind', async () => {
    const p = await createPlayer('catalog_hardware');
    const { ws } = await connectPlayer(p.token);
    try {
      const res = await wsRequest(
        ws,
        { type: ClientTag.HardwareCatalog },
        ServerTag.HardwareCatalogResult,
      );
      assert.equal(res.type, ServerTag.HardwareCatalogResult);

      const db = await pool.query('SELECT name, label, kind FROM hardware_item ORDER BY id');
      assert.deepEqual(res.items, db.rows);
      for (const item of res.items) {
        assert.ok(['stackable', 'toggle'].includes(item.kind), `${item.name} kind`);
      }
    } finally {
      await closeWS(ws);
    }
  });
});

describe('TraderList', () => {
  it('lists every player in the universe, including offline ones, by experience', async () => {
    const online = await createPlayer('trader_online');
    await createPlayer('trader_offline');
    const { ws } = await connectPlayer(online.token);
    try {
      const res = await wsRequest(ws, { type: ClientTag.TraderList }, ServerTag.TraderListResult);
      assert.equal(res.type, ServerTag.TraderListResult);

      const names = res.traders.map((t) => t.name);
      assert.ok(names.includes('trader_online'));
      assert.ok(names.includes('trader_offline'));

      const me = res.traders.find((t) => t.name === 'trader_online');
      assert.equal(me.shipName, STARTER_SLUG);
      assert.equal(me.clanNumber, null);
      assert.equal(typeof me.reputation, 'number');

      const db = await pool.query('SELECT COUNT(*)::int AS n FROM players WHERE universe_id = $1', [
        UNIVERSE_ID,
      ]);
      assert.equal(res.traders.length, db.rows[0].n);
      for (let i = 1; i < res.traders.length; i++) {
        assert.ok(res.traders[i - 1].experience >= res.traders[i].experience);
      }
    } finally {
      await closeWS(ws);
    }
  });
});

describe('Class-0 price list', () => {
  it('DockStarbaseResult carries today\'s class-0 prices', async () => {
    const sb = await pool.query(
      `SELECT s.sector_number FROM ports p JOIN sectors s ON s.id = p.sector_id
       WHERE s.universe_id = $1 AND p.class = 9 LIMIT 1`,
      [UNIVERSE_ID],
    );
    assert.ok(sb.rows[0], 'universe has a starbase');
    const p = await createPlayer('class0_starbase', sb.rows[0].sector_number);
    const { ws } = await connectPlayer(p.token);
    try {
      const res = await wsRequest(
        ws,
        { type: ClientTag.DockStarbase },
        ServerTag.DockStarbaseResult,
      );
      assert.equal(res.type, ServerTag.DockStarbaseResult);

      const cfg = loadStockJson('class0-prices.json');
      assert.equal(res.class0Prices.dronePrice, cfg.dronePrice);
      assert.equal(res.class0Prices.shieldPrice, cfg.shieldPrice);
      assert.equal(res.class0Prices.holdCostIncrement, HOLD_COST_INCREMENT);
      assert.ok(res.class0Prices.holdBaseCost >= cfg.holdBaseCostMin);
      assert.ok(res.class0Prices.holdBaseCost <= cfg.holdBaseCostMax);
    } finally {
      await closeWS(ws);
    }
  });

  it('DockResult at a class-0 port carries the same price list', async () => {
    const c0 = await pool.query(
      `SELECT s.sector_number FROM ports p JOIN sectors s ON s.id = p.sector_id
       WHERE s.universe_id = $1 AND p.class = 0 LIMIT 1`,
      [UNIVERSE_ID],
    );
    assert.ok(c0.rows[0], 'universe has a class-0 port');
    const p = await createPlayer('class0_port', c0.rows[0].sector_number);
    const { ws } = await connectPlayer(p.token);
    try {
      const res = await wsRequest(ws, { type: ClientTag.Dock }, ServerTag.DockResult);
      assert.equal(res.type, ServerTag.DockResult);
      assert.equal(res.port.class, 0);
      assert.ok(res.class0Prices, 'class-0 dock includes price list');
      assert.equal(typeof res.class0Prices.holdBaseCost, 'number');
    } finally {
      await closeWS(ws);
    }
  });
});

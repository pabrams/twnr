import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPool, connectWS as _connectWS, closeWS, wsRequest, startServer, testEnv } from './helpers.mjs';

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
let serverProc;

function connectWS(opts = {}) {
  return _connectWS({ pool, universeId: UNIVERSE_ID, ...opts });
}

async function findFuelSellerSector() {
  const res = await pool.query('SELECT sector_id FROM ports WHERE class IN (3, 4, 6, 7) AND universe_id = $1 LIMIT 1', [UNIVERSE_ID]);
  return res.rows.length > 0 ? Number(res.rows[0].sector_id) : null;
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

describe('Config Files', () => {
  it('config/ships/merchant.json exists', () => {
    const p = join(PROJECT_ROOT, 'config', 'ships', 'merchant.json');
    assert.ok(existsSync(p), 'merchant.json should exist at config/ships/merchant.json');
  });

  it('merchant.json has correct fields and values', () => {
    const p = join(PROJECT_ROOT, 'config', 'ships', 'merchant.json');
    assert.ok(existsSync(p), 'merchant.json must exist');
    const cfg = JSON.parse(readFileSync(p, 'utf8'));
    assert.equal(cfg.name, 'Merchant Freighter');
    assert.equal(cfg.maxFighters, 10);
    assert.equal(cfg.maxShields, 10);
    assert.equal(cfg.startingHolds, 5, 'startingHolds should be 5');
    assert.equal(cfg.maxHolds, 20, 'maxHolds (cap) should be 20');
    assert.equal(cfg.price, 5000);
  });

  it('config/ships/warbird.json exists', () => {
    const p = join(PROJECT_ROOT, 'config', 'ships', 'warbird.json');
    assert.ok(existsSync(p), 'warbird.json should exist at config/ships/warbird.json');
  });

  it('warbird.json has correct fields and values', () => {
    const p = join(PROJECT_ROOT, 'config', 'ships', 'warbird.json');
    assert.ok(existsSync(p), 'warbird.json must exist');
    const cfg = JSON.parse(readFileSync(p, 'utf8'));
    assert.equal(cfg.name, 'Warbird');
    assert.equal(cfg.maxFighters, 30);
    assert.equal(cfg.maxShields, 25);
    assert.equal(cfg.startingHolds, 1, 'startingHolds should be 1');
    assert.equal(cfg.maxHolds, 5, 'maxHolds (cap) should be 5');
    assert.equal(cfg.price, 8000);
  });
});

describe('Database Schema', () => {
  it('player_ships table exists', async () => {
    const res = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'player_ships'`
    );
    assert.equal(res.rows.length, 1, 'player_ships table should exist');
  });

  it('player_ships has required columns including cargo_limit', async () => {
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'player_ships' ORDER BY column_name`
    );
    const cols = res.rows.map(r => r.column_name);
    assert.ok(cols.includes('player_id'), 'should have player_id');
    assert.ok(cols.includes('ship_name'), 'should have ship_name');
    assert.ok(cols.includes('fighters'), 'should have fighters');
    assert.ok(cols.includes('shields'), 'should have shields');
    assert.ok(cols.includes('cargo_limit'), 'should have cargo_limit (not max_holds)');
  });
});

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

describe('Trade at class 0 port', () => {
  it('returns error when buying a commodity at a class 0 port', async () => {
    // New players start at sector 1, which has a class 0 port
    const { ws } = await connectWS();
    try {
      const msg = await wsRequest(ws, { type: 'portTransaction', good: 'fuel', quantity: 1, action: 'buy' }, 'portTransactionResult');
      assert.equal(msg.type, 'error');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns error when selling a commodity at a class 0 port', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      await pool.query('UPDATE ship_cargo SET fuel = 3 WHERE player_id = $1', [playerId]);
      const msg = await wsRequest(ws, { type: 'portTransaction', good: 'fuel', quantity: 1, action: 'sell' }, 'portTransactionResult');
      assert.equal(msg.type, 'error');
    } finally {
      await closeWS(ws);
    }
  });
});

describe('Cargo hold enforcement', () => {
  it('buying cargo exceeding cargo_limit returns "Insufficient cargo holds"', async () => {
    const fuelSector = await findFuelSellerSector();
    assert.ok(fuelSector, 'Need a fuel-selling port for this test');

    const { ws } = await connectWS();
    try {
      await navigateTo(ws, fuelSector);
      // cargo_limit is 5; try to buy 6
      const msg = await wsRequest(ws, { type: 'portTransaction', good: 'fuel', quantity: 6, action: 'buy' }, 'portTransactionResult');
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'Insufficient cargo holds');
    } finally {
      await closeWS(ws);
    }
  });

  it('buying exactly cargo_limit units succeeds', async () => {
    const fuelSector = await findFuelSellerSector();
    assert.ok(fuelSector, 'Need a fuel-selling port for this test');

    const { ws } = await connectWS();
    try {
      await navigateTo(ws, fuelSector);
      const msg = await wsRequest(ws, { type: 'portTransaction', good: 'fuel', quantity: 5, action: 'buy' }, 'portTransactionResult');
      assert.equal(msg.type, 'portTransactionResult', 'buying exactly cargo_limit should succeed');
    } finally {
      await closeWS(ws);
    }
  });

  it('buying any cargo when holds are full returns error', async () => {
    const fuelSector = await findFuelSellerSector();
    assert.ok(fuelSector, 'Need a fuel-selling port for this test');

    const { ws } = await connectWS();
    try {
      await navigateTo(ws, fuelSector);
      await wsRequest(ws, { type: 'portTransaction', good: 'fuel', quantity: 5, action: 'buy' }, 'portTransactionResult');
      const msg = await wsRequest(ws, { type: 'portTransaction', good: 'fuel', quantity: 1, action: 'buy' }, 'portTransactionResult');
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'Insufficient cargo holds');
    } finally {
      await closeWS(ws);
    }
  });
});

describe('Buy fighters — validation', () => {
  it('returns "Not at a class 0 port" when not in a class 0 sector', async () => {
    const res = await pool.query('SELECT sector_id FROM ports WHERE class != 0 AND universe_id = $1 LIMIT 1', [UNIVERSE_ID]);
    assert.ok(res.rows.length > 0, 'Need a non-class-0 sector');
    const otherSector = Number(res.rows[0].sector_id);

    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      await pool.query('UPDATE players SET current_sector = $1 WHERE id = $2', [otherSector, playerId]);
      const msg = await wsRequest(ws, { type: 'buyFighters', quantity: 1 }, 'buyResult');
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'Not at a class 0 port');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns "Invalid quantity" for quantity 0', async () => {
    const { ws } = await connectWS();
    try {
      const msg = await wsRequest(ws, { type: 'buyFighters', quantity: 0 }, 'buyResult');
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'Invalid quantity');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns "Invalid quantity" for negative quantity', async () => {
    const { ws } = await connectWS();
    try {
      const msg = await wsRequest(ws, { type: 'buyFighters', quantity: -1 }, 'buyResult');
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'Invalid quantity');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns "Invalid quantity" for a float quantity', async () => {
    const { ws } = await connectWS();
    try {
      const msg = await wsRequest(ws, { type: 'buyFighters', quantity: 1.5 }, 'buyResult');
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'Invalid quantity');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns "Exceeds maximum" when fighters + quantity > maxFighters', async () => {
    const { ws } = await connectWS();
    try {
      const msg = await wsRequest(ws, { type: 'buyFighters', quantity: merchantCfg.maxFighters + 1 }, 'buyResult');
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'Exceeds maximum');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns "Insufficient credits" when player cannot afford fighters', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      await pool.query('UPDATE ship_cargo SET credits = 0 WHERE player_id = $1', [playerId]);
      const msg = await wsRequest(ws, { type: 'buyFighters', quantity: 1 }, 'buyResult');
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'Insufficient credits');
    } finally {
      await closeWS(ws);
    }
  });
});

describe('Buy shields — validation', () => {
  it('returns "Invalid quantity" for quantity 0', async () => {
    const { ws } = await connectWS();
    try {
      const msg = await wsRequest(ws, { type: 'buyShields', quantity: 0 }, 'buyResult');
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'Invalid quantity');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns "Invalid quantity" for negative quantity', async () => {
    const { ws } = await connectWS();
    try {
      const msg = await wsRequest(ws, { type: 'buyShields', quantity: -1 }, 'buyResult');
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'Invalid quantity');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns "Invalid quantity" for a float quantity', async () => {
    const { ws } = await connectWS();
    try {
      const msg = await wsRequest(ws, { type: 'buyShields', quantity: 2.9 }, 'buyResult');
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'Invalid quantity');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns "Not at a class 0 port" when not in a class 0 sector', async () => {
    const res = await pool.query('SELECT sector_id FROM ports WHERE class != 0 AND universe_id = $1 LIMIT 1', [UNIVERSE_ID]);
    assert.ok(res.rows.length > 0, 'Need a non-class-0 sector');
    const otherSector = Number(res.rows[0].sector_id);

    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      await pool.query('UPDATE players SET current_sector = $1 WHERE id = $2', [otherSector, playerId]);
      const msg = await wsRequest(ws, { type: 'buyShields', quantity: 1 }, 'buyResult');
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'Not at a class 0 port');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns "Exceeds maximum" when shields + quantity > maxShields', async () => {
    const { ws } = await connectWS();
    try {
      const msg = await wsRequest(ws, { type: 'buyShields', quantity: merchantCfg.maxShields + 1 }, 'buyResult');
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'Exceeds maximum');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns "Insufficient credits" when player cannot afford shields', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      await pool.query('UPDATE ship_cargo SET credits = 0 WHERE player_id = $1', [playerId]);
      const msg = await wsRequest(ws, { type: 'buyShields', quantity: 1 }, 'buyResult');
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'Insufficient credits');
    } finally {
      await closeWS(ws);
    }
  });
});

describe('Buy holds — validation', () => {
  it('returns "Invalid quantity" for quantity 0', async () => {
    const { ws } = await connectWS();
    try {
      const msg = await wsRequest(ws, { type: 'buyHolds', quantity: 0 }, 'buyResult');
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'Invalid quantity');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns "Invalid quantity" for negative quantity', async () => {
    const { ws } = await connectWS();
    try {
      const msg = await wsRequest(ws, { type: 'buyHolds', quantity: -1 }, 'buyResult');
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'Invalid quantity');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns "Invalid quantity" for a float quantity', async () => {
    const { ws } = await connectWS();
    try {
      const msg = await wsRequest(ws, { type: 'buyHolds', quantity: 0.5 }, 'buyResult');
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'Invalid quantity');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns "Not at a class 0 port" when not in a class 0 sector', async () => {
    const res = await pool.query('SELECT sector_id FROM ports WHERE class != 0 AND universe_id = $1 LIMIT 1', [UNIVERSE_ID]);
    assert.ok(res.rows.length > 0, 'Need a non-class-0 sector');
    const otherSector = Number(res.rows[0].sector_id);

    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      await pool.query('UPDATE players SET current_sector = $1 WHERE id = $2', [otherSector, playerId]);
      const msg = await wsRequest(ws, { type: 'buyHolds', quantity: 1 }, 'buyResult');
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'Not at a class 0 port');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns "Insufficient credits" when player cannot afford holds', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      await pool.query('UPDATE ship_cargo SET credits = 0 WHERE player_id = $1', [playerId]);
      const msg = await wsRequest(ws, { type: 'buyHolds', quantity: 1 }, 'buyResult');
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'Insufficient credits');
    } finally {
      await closeWS(ws);
    }
  });
});

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

describe('Ship exchange — validation', () => {
  async function getStardockSector() {
    const res = await pool.query(`SELECT id FROM sectors WHERE name = 'Stardock' AND universe_id = $1`, [UNIVERSE_ID]);
    return res.rows.length > 0 ? Number(res.rows[0].id) : null;
  }

  it('returns "Not at Stardock" when player is not in Stardock', async () => {
    const { ws } = await connectWS();
    try {
      const msg = await wsRequest(ws, { type: 'shipExchange', targetShipName: warbirdCfg.name }, 'shipExchangeResult');
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
      const msg = await wsRequest(ws, { type: 'shipExchange', targetShipName: 'Galaxy Hauler' }, 'shipExchangeResult');
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
      const msg = await wsRequest(ws, { type: 'shipExchange', targetShipName: merchantCfg.name }, 'shipExchangeResult');
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
      const msg = await wsRequest(ws, { type: 'shipExchange', targetShipName: warbirdCfg.name }, 'shipExchangeResult');
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
      const msg = await wsRequest(ws, { type: 'shipExchange', targetShipName: warbirdCfg.name }, 'shipExchangeResult');
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'New ship has insufficient holds for current cargo');
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
      const msg = await wsRequest(ws, { type: 'shipExchange', targetShipName: warbirdCfg.name }, 'shipExchangeResult');
      assert.equal(msg.type, 'shipExchangeResult');
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
      await wsRequest(ws, { type: 'buyFighters', quantity: Math.min(5, merchantCfg.maxFighters) }, 'buyResult');
      await wsRequest(ws, { type: 'buyShields', quantity: Math.min(4, merchantCfg.maxShields) }, 'buyResult');

      await navigateTo(ws, stardockId);
      const msg = await wsRequest(ws, { type: 'shipExchange', targetShipName: warbirdCfg.name }, 'shipExchangeResult');
      assert.equal(msg.type, 'shipExchangeResult');

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
      await wsRequest(ws, { type: 'shipExchange', targetShipName: warbirdCfg.name }, 'shipExchangeResult');
      // Now downgrade
      const msg = await wsRequest(ws, { type: 'shipExchange', targetShipName: merchantCfg.name }, 'shipExchangeResult');
      assert.equal(msg.type, 'shipExchangeResult');
      assert.equal(msg.shipName, merchantCfg.name);
      assert.equal(msg.credits, STARTING_CREDITS, 'credits restored after upgrade then downgrade');
      assert.equal(msg.cargoLimit, merchantCfg.startingHolds);
    } finally {
      await closeWS(ws);
    }
  });
});

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

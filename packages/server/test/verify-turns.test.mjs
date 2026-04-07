/**
 * Turns system verification tests.
 * Each test sets up exactly the DB state it needs — no port scanning loops.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { ensureServer, createPool, BASE, JWT_SECRET, testEnv } from './global-setup.mjs';
import { connectWS, closeWS, wsRequest, createTestUser, movePlayerTo } from './helpers.mjs';
import { ClientMsgType, ServerMsgType } from '@twnr/shared';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = join(dirname(__filename), '..');

const UNIVERSE_ID = 1;

// ─── helpers unique to this file ───────────────────────────────────────────

/** Create player via the /join endpoint so server sets turns, last_turns_granted_at, turns_per_warp */
async function joinUniverse(pool, universeId = UNIVERSE_ID) {
  const { userId, token } = await createTestUser(pool);
  const res = await fetch(`${BASE}/api/universes/${universeId}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `twnr_auth=${token}` },
    body: JSON.stringify({ name: `P_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }),
  });
  if (!res.ok) throw new Error(`join failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  return { userId, token, playerId: body.playerId };
}

function ws(token, universeId = UNIVERSE_ID) {
  return connectWS({ token, universeId });
}

/** Find an adjacent sector to the player's current sector */
async function getAdjacentSector(wsConn) {
  const disp = await wsRequest(wsConn, { type: ClientMsgType.SectorDisplay }, ServerMsgType.SectorDisplayResult);
  return disp.warps?.[0];
}

/** Clear any sector fighters so movement doesn't trigger encounters */
async function clearSectorFighters(sectorId, universeId = UNIVERSE_ID) {
  await pool.query('DELETE FROM sector_fighters WHERE sector_id = $1 AND universe_id = $2', [sectorId, universeId]);
}

/** Put a selling port (class 6: sells fuel) in a given sector via DB */
async function ensureSellingPort(pool, sectorId, universeId = UNIVERSE_ID) {
  await pool.query(`
    INSERT INTO ports (sector_id, universe_id, class, fuel, fuel_price, organics, org_price, equipment, equ_price)
    VALUES ($1, $2, 6, 1000, 5, 1000, 5, 1000, 5)
    ON CONFLICT (sector_id, universe_id) DO UPDATE SET class = 6, fuel = 1000, fuel_price = 5
  `, [sectorId, universeId]);
}

/** Put a port that buys fuel (class 1: buys fuel+organics, sells equipment) */
async function ensureBuyingPort(pool, sectorId, universeId = UNIVERSE_ID) {
  await pool.query(`
    INSERT INTO ports (sector_id, universe_id, class, fuel, fuel_price, organics, org_price, equipment, equ_price)
    VALUES ($1, $2, 1, 1000, 5, 1000, 5, 1000, 5)
    ON CONFLICT (sector_id, universe_id) DO UPDATE SET class = 1, fuel = 1000, fuel_price = 5
  `, [sectorId, universeId]);
}

/** Find the Stardock sector (port class 9) */
async function findStardockSector() {
  const res = await pool.query('SELECT sector_id FROM ports WHERE universe_id = $1 AND class = 9 LIMIT 1', [UNIVERSE_ID]);
  return res.rows.length > 0 ? res.rows[0].sector_id : null;
}

/** Move player to stardock, dock, and return ws + player info */
async function goToStardock(pool) {
  const { token, playerId } = await joinUniverse(pool);
  await pool.query('UPDATE players SET turns = 9999 WHERE id = $1', [playerId]);
  const { ws: wsConn } = await ws(token);

  const stardockSector = await findStardockSector();
  assert.ok(stardockSector, 'Stardock sector must exist');

  const moved = await movePlayerToViaWs(wsConn, stardockSector);
  assert.ok(moved, 'Must be able to reach Stardock');

  await wsRequest(wsConn, { type: ClientMsgType.DockStardock }, ServerMsgType.DockStardockResult);
  return { ws: wsConn, token, playerId, stardockSector };
}

/** Ensure a planet exists in the given sector, creating one if needed. Returns planet id. */
async function ensurePlanetInSector(sectorId, universeId = UNIVERSE_ID) {
  const existing = await pool.query('SELECT id FROM planets WHERE sector_id = $1 AND universe_id = $2 LIMIT 1', [sectorId, universeId]);
  if (existing.rows.length > 0) return existing.rows[0].id;
  const maxId = await pool.query('SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM planets WHERE universe_id = $1', [universeId]);
  const nextId = maxId.rows[0].next_id;
  await pool.query(
    `INSERT INTO planets (id, sector_id, universe_id, name, type) VALUES ($1, $2, $3, 'TestPlanet', 'H')`,
    [nextId, sectorId, universeId],
  );
  return nextId;
}

/** Deploy fighters in a sector for a player (directly via DB) */
async function deployFightersInSector(pool, playerId, sectorId, quantity, universeId = UNIVERSE_ID) {
  await pool.query(`
    INSERT INTO sector_fighters (sector_id, universe_id, owner_id, quantity)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (sector_id, universe_id) DO UPDATE SET owner_id = $3, quantity = $4
  `, [sectorId, universeId, playerId, quantity]);
}

/** Move player to a specific sector, clearing fighters en route */
async function movePlayerToViaWs(wsConn, targetSector) {
  const disp = await wsRequest(wsConn, { type: ClientMsgType.SectorDisplay }, ServerMsgType.SectorDisplayResult);
  if (disp.sector === targetSector) return true;
  const pathRes = await wsRequest(wsConn, { type: ClientMsgType.ShortestPath, from: disp.sector, to: targetSector }, ServerMsgType.ShortestPathResult);
  if (pathRes.type === ServerMsgType.Error) return false;
  for (let i = 1; i < pathRes.path.length; i++) {
    await clearSectorFighters(pathRes.path[i]);
    const r = await wsRequest(wsConn, { type: ClientMsgType.Move, sector: pathRes.path[i] }, ServerMsgType.MoveResult);
    if (r.type === ServerMsgType.Error || r.outcome === 'error') return false;
  }
  return true;
}

// ============================================================
// TESTS
// ============================================================

let pool;

before(async () => {
  await ensureServer();
  pool = createPool();
});

after(async () => {
  if (pool) await pool.end();
});

// --- Schema tests ---

describe('Schema - Universe columns', () => {
  it('turns_per_day column exists with default 500', async () => {
    const res = await pool.query(`SELECT data_type, column_default, is_nullable FROM information_schema.columns WHERE table_name = 'universes' AND column_name = 'turns_per_day'`);
    assert.equal(res.rows.length, 1); assert.match(res.rows[0].data_type, /int/i);
    assert.equal(res.rows[0].is_nullable, 'NO'); assert.match(res.rows[0].column_default, /500/);
  });
  it('starting_turns column exists with default 500', async () => {
    const res = await pool.query(`SELECT data_type, column_default, is_nullable FROM information_schema.columns WHERE table_name = 'universes' AND column_name = 'starting_turns'`);
    assert.equal(res.rows.length, 1); assert.match(res.rows[0].data_type, /int/i);
    assert.equal(res.rows[0].is_nullable, 'NO'); assert.match(res.rows[0].column_default, /500/);
  });
  it('max_turns column exists with default 2000', async () => {
    const res = await pool.query(`SELECT data_type, column_default, is_nullable FROM information_schema.columns WHERE table_name = 'universes' AND column_name = 'max_turns'`);
    assert.equal(res.rows.length, 1); assert.match(res.rows[0].data_type, /int/i);
    assert.equal(res.rows[0].is_nullable, 'NO'); assert.match(res.rows[0].column_default, /2000/);
  });
});

describe('Schema - Player columns', () => {
  it('players.turns exists (integer, NOT NULL)', async () => {
    const res = await pool.query(`SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name = 'players' AND column_name = 'turns'`);
    assert.equal(res.rows.length, 1); assert.match(res.rows[0].data_type, /int/i); assert.equal(res.rows[0].is_nullable, 'NO');
  });
  it('players.last_turns_granted_at exists (timestamptz, NOT NULL)', async () => {
    const res = await pool.query(`SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name = 'players' AND column_name = 'last_turns_granted_at'`);
    assert.equal(res.rows.length, 1); assert.match(res.rows[0].data_type, /timestamp/i); assert.equal(res.rows[0].is_nullable, 'NO');
  });
});

describe('Schema - Ship columns', () => {
  it('player_ships.turns_per_warp exists (integer, NOT NULL, default 1)', async () => {
    const res = await pool.query(`SELECT data_type, column_default, is_nullable FROM information_schema.columns WHERE table_name = 'player_ships' AND column_name = 'turns_per_warp'`);
    assert.equal(res.rows.length, 1); assert.match(res.rows[0].data_type, /int/i);
    assert.equal(res.rows[0].is_nullable, 'NO'); assert.match(res.rows[0].column_default, /1/);
  });
});

// --- Ship config tests ---

describe('Ship configs', () => {
  it('Merchant Freighter has turnsPerWarp = 3', () => {
    const cfg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'ships', 'merchant.json'), 'utf8'));
    assert.equal(cfg.turnsPerWarp, 3);
  });
  it('All ship configs have turnsPerWarp >= 1', () => {
    const files = readdirSync(join(PROJECT_ROOT, 'config', 'ships')).filter(f => f.endsWith('.json'));
    assert.ok(files.length > 0);
    for (const file of files) {
      const cfg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'ships', file), 'utf8'));
      assert.ok(typeof cfg.turnsPerWarp === 'number' && cfg.turnsPerWarp >= 1, `${file}: turnsPerWarp must be >= 1, got ${cfg.turnsPerWarp}`);
    }
  });
  it('Non-Merchant ships default to turnsPerWarp = 2', () => {
    const files = readdirSync(join(PROJECT_ROOT, 'config', 'ships')).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const cfg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'ships', file), 'utf8'));
      if (cfg.name !== 'Merchant Freighter') {
        assert.equal(cfg.turnsPerWarp, 2, `${file}: non-Merchant ships should have turnsPerWarp = 2, got ${cfg.turnsPerWarp}`);
      }
    }
  });
});

// --- Player initialization ---

describe('Player initialization', () => {
  it('New player gets turns = starting_turns', async () => {
    await pool.query('UPDATE universes SET starting_turns = 250 WHERE id = $1', [UNIVERSE_ID]);
    try {
      const { playerId } = await joinUniverse(pool);
      const r = await pool.query('SELECT turns FROM players WHERE id = $1', [playerId]);
      assert.equal(r.rows[0].turns, 250);
    } finally {
      await pool.query('UPDATE universes SET starting_turns = 500 WHERE id = $1', [UNIVERSE_ID]);
    }
  });

  it('New player gets last_turns_granted_at set', async () => {
    const beforeTime = new Date();
    const { playerId } = await joinUniverse(pool);
    const r = await pool.query('SELECT last_turns_granted_at FROM players WHERE id = $1', [playerId]);
    assert.ok(new Date(r.rows[0].last_turns_granted_at) >= new Date(beforeTime.getTime() - 2000));
  });

  it('New player ship has turns_per_warp from config', async () => {
    const { playerId } = await joinUniverse(pool);
    const r = await pool.query('SELECT ship_name, turns_per_warp FROM player_ships WHERE player_id = $1', [playerId]);
    assert.ok(r.rows.length > 0);
    assert.ok(r.rows[0].turns_per_warp >= 1);
    if (r.rows[0].ship_name === 'Merchant Freighter') assert.equal(r.rows[0].turns_per_warp, 3);
  });
});

// --- ShipInfo includes turns fields ---

describe('ShipInfo includes turn and hyperwarp fields', () => {
  it('ShipInfo response includes turnsPerWarp', async () => {
    const { token } = await joinUniverse(pool);
    const { ws: wsConn } = await ws(token);

    const result = await wsRequest(wsConn, { type: ClientMsgType.ShipInfo }, ServerMsgType.ShipInfoResult);
    assert.equal(result.type, ServerMsgType.ShipInfoResult);
    assert.ok('turnsPerWarp' in result, 'shipInfoResult must include turnsPerWarp');
    assert.ok(typeof result.turnsPerWarp === 'number');

    await closeWS(wsConn);
  });

  it('ShipInfo response includes hasHyperwarpDrive', async () => {
    const { token } = await joinUniverse(pool);
    const { ws: wsConn } = await ws(token);

    const result = await wsRequest(wsConn, { type: ClientMsgType.ShipInfo }, ServerMsgType.ShipInfoResult);
    assert.equal(result.type, ServerMsgType.ShipInfoResult);
    assert.ok('hasHyperwarpDrive' in result, 'shipInfoResult must include hasHyperwarpDrive');
    assert.equal(typeof result.hasHyperwarpDrive, 'boolean');

    await closeWS(wsConn);
  });

  it('ShipInfo response includes turns (player current turns)', async () => {
    const { token, playerId } = await joinUniverse(pool);
    await pool.query('UPDATE players SET turns = 42 WHERE id = $1', [playerId]);
    const { ws: wsConn } = await ws(token);

    const result = await wsRequest(wsConn, { type: ClientMsgType.ShipInfo }, ServerMsgType.ShipInfoResult);
    assert.equal(result.type, ServerMsgType.ShipInfoResult);
    assert.ok('turns' in result, 'shipInfoResult must include turns');
    assert.equal(result.turns, 42);

    await closeWS(wsConn);
  });

  it('ShipInfo turnsPerWarp matches DB value after trade-in', async () => {
    const { token, playerId } = await joinUniverse(pool);
    await pool.query("UPDATE player_ships SET turns_per_warp = 5 WHERE player_id = $1", [playerId]);
    const { ws: wsConn } = await ws(token);

    const result = await wsRequest(wsConn, { type: ClientMsgType.ShipInfo }, ServerMsgType.ShipInfoResult);
    assert.equal(result.turnsPerWarp, 5);

    await closeWS(wsConn);
  });
});

// --- Ship trade-in resets turns_per_warp and has_hyperwarp_drive ---

describe('Ship trade-in resets ship-specific fields', () => {
  it('After trade-in, turns_per_warp matches new ship config', async () => {
    const { token, playerId } = await joinUniverse(pool);
    await pool.query('UPDATE players SET turns = 9999 WHERE id = $1', [playerId]);
    const { ws: wsConn } = await ws(token);

    const stardockRes = await pool.query('SELECT sector_id FROM ports WHERE universe_id = $1 AND class = 9 LIMIT 1', [UNIVERSE_ID]);
    assert.ok(stardockRes.rows.length > 0, 'Stardock must exist');
    const stardockSector = stardockRes.rows[0].sector_id;
    const moved = await movePlayerToViaWs(wsConn, stardockSector);
    assert.ok(moved, 'Must reach Stardock');

    await wsRequest(wsConn, { type: ClientMsgType.DockStardock }, ServerMsgType.DockStardockResult);
    await pool.query('UPDATE ship_cargo SET credits = 999999 WHERE player_id = $1', [playerId]);

    const scoutCfg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'ships', 'scout.json'), 'utf8'));
    const result = await wsRequest(wsConn, { type: ClientMsgType.BuyShipTradein, targetShipName: 'Scout Marauder' }, ServerMsgType.BuyShipTradeinResult);
    if (result.type === ServerMsgType.Error) { await closeWS(wsConn); assert.fail(`Trade failed: ${result.message}`); }

    const shipRes = await pool.query('SELECT turns_per_warp FROM player_ships WHERE player_id = $1', [playerId]);
    assert.equal(shipRes.rows[0].turns_per_warp, scoutCfg.turnsPerWarp,
      `turns_per_warp should match Scout config (${scoutCfg.turnsPerWarp})`);

    await closeWS(wsConn);
  });

  it('After trade-in, has_hyperwarp_drive is false', async () => {
    const { token, playerId } = await joinUniverse(pool);
    await pool.query('UPDATE players SET turns = 9999 WHERE id = $1', [playerId]);
    const { ws: wsConn } = await ws(token);

    const stardockRes = await pool.query('SELECT sector_id FROM ports WHERE universe_id = $1 AND class = 9 LIMIT 1', [UNIVERSE_ID]);
    const stardockSector = stardockRes.rows[0].sector_id;
    await movePlayerToViaWs(wsConn, stardockSector);
    await wsRequest(wsConn, { type: ClientMsgType.DockStardock }, ServerMsgType.DockStardockResult);

    await pool.query('UPDATE player_ships SET has_hyperwarp_drive = true WHERE player_id = $1', [playerId]);
    await pool.query('UPDATE ship_cargo SET credits = 999999 WHERE player_id = $1', [playerId]);

    const result = await wsRequest(wsConn, { type: ClientMsgType.BuyShipTradein, targetShipName: 'Scout Marauder' }, ServerMsgType.BuyShipTradeinResult);
    if (result.type === ServerMsgType.Error) { await closeWS(wsConn); assert.fail(`Trade failed: ${result.message}`); }

    const driveRes = await pool.query('SELECT has_hyperwarp_drive FROM player_ships WHERE player_id = $1', [playerId]);
    assert.equal(driveRes.rows[0].has_hyperwarp_drive, false,
      'Hyperwarp drive should not transfer to new ship');

    await closeWS(wsConn);
  });
});

// --- Warp turn costs ---

describe('Warp turn costs', () => {
  it('Warping deducts turns_per_warp and response includes turnsUsed', async () => {
    const { token, playerId } = await joinUniverse(pool);
    await pool.query('UPDATE players SET turns = 100 WHERE id = $1', [playerId]);
    const { ws: wsConn } = await ws(token);

    const tpw = (await pool.query('SELECT turns_per_warp FROM player_ships WHERE player_id = $1', [playerId])).rows[0].turns_per_warp;
    const adj = await getAdjacentSector(wsConn);
    assert.ok(adj, 'Need adjacent sector');
    await pool.query('DELETE FROM sector_fighters WHERE sector_id = $1 AND universe_id = $2', [adj, UNIVERSE_ID]);

    const result = await wsRequest(wsConn, { type: ClientMsgType.Move, sector: adj }, ServerMsgType.MoveResult);
    assert.equal(result.outcome, 'success');
    assert.equal(result.turnsUsed, tpw);
    const afterTurns = (await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns;
    assert.equal(afterTurns, 100 - tpw);

    await closeWS(wsConn);
  });

  it('Warping rejected when insufficient turns', async () => {
    const { token, playerId } = await joinUniverse(pool);
    await pool.query('UPDATE players SET turns = 0 WHERE id = $1', [playerId]);
    const { ws: wsConn } = await ws(token);

    const adj = await getAdjacentSector(wsConn);
    assert.ok(adj);
    await clearSectorFighters(adj);
    const result = await wsRequest(wsConn, { type: ClientMsgType.Move, sector: adj }, ServerMsgType.MoveResult);
    assert.ok(result.type === ServerMsgType.Error || result.outcome === 'error');
    assert.match(result.message.toLowerCase(), /insufficient turns/);

    await closeWS(wsConn);
  });
});

// --- Unlimited universe warp ---

describe('Unlimited universe - warp', () => {
  before(() => pool.query('UPDATE universes SET turns_per_day = 0 WHERE id = $1', [UNIVERSE_ID]));
  after(() => pool.query('UPDATE universes SET turns_per_day = 500 WHERE id = $1', [UNIVERSE_ID]));

  it('Unlimited: warp turnsUsed = 0, no deduction', async () => {
    const { token, playerId } = await joinUniverse(pool);
    await pool.query('UPDATE players SET turns = 10 WHERE id = $1', [playerId]);
    const { ws: wsConn } = await ws(token);

    const adj = await getAdjacentSector(wsConn);
    await clearSectorFighters(adj);
    const result = await wsRequest(wsConn, { type: ClientMsgType.Move, sector: adj }, ServerMsgType.MoveResult);
    assert.equal(result.outcome, 'success');
    assert.equal(result.turnsUsed, 0);
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 10);

    await closeWS(wsConn);
  });

  it('Unlimited: warp succeeds with 0 turns', async () => {
    const { token, playerId } = await joinUniverse(pool);
    await pool.query('UPDATE players SET turns = 0 WHERE id = $1', [playerId]);
    const { ws: wsConn } = await ws(token);

    const adj = await getAdjacentSector(wsConn);
    await clearSectorFighters(adj);
    const result = await wsRequest(wsConn, { type: ClientMsgType.Move, sector: adj }, ServerMsgType.MoveResult);
    assert.equal(result.outcome, 'success');

    await closeWS(wsConn);
  });
});

// --- Docking ---

describe('Docking costs 0 turns', () => {
  it('Docking at a port costs 0 turns', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws: wsConn } = await ws(token);

    const adj = await getAdjacentSector(wsConn);
    assert.ok(adj);
    await ensureSellingPort(pool, adj);
    await pool.query('DELETE FROM sector_fighters WHERE sector_id = $1 AND universe_id = $2', [adj, UNIVERSE_ID]);
    await wsRequest(wsConn, { type: ClientMsgType.Move, sector: adj }, ServerMsgType.MoveResult);

    await pool.query('UPDATE players SET turns = 50 WHERE id = $1', [playerId]);
    const dockRes = await wsRequest(wsConn, { type: ClientMsgType.Dock }, ServerMsgType.DockResult);
    assert.ok(dockRes.docked);
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 50);

    await closeWS(wsConn);
  });
});

// --- Buy cargo ---

describe('Buy cargo turn costs', () => {
  it('Buying cargo costs 1 turn and includes turnsUsed', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws: wsConn } = await ws(token);

    const adj = await getAdjacentSector(wsConn);
    await ensureSellingPort(pool, adj);
    await clearSectorFighters(adj);
    await wsRequest(wsConn, { type: ClientMsgType.Move, sector: adj }, ServerMsgType.MoveResult);
    await wsRequest(wsConn, { type: ClientMsgType.Dock }, ServerMsgType.DockResult);

    await pool.query('UPDATE players SET turns = 50 WHERE id = $1', [playerId]);
    const result = await wsRequest(wsConn, { type: ClientMsgType.PortTransaction, good: 'fuel', quantity: 1, action: 'buy' }, ServerMsgType.PortTransactionResult);
    assert.equal(result.type, ServerMsgType.PortTransactionResult);
    assert.equal(result.turnsUsed, 1);
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 49);

    await closeWS(wsConn);
  });

  it('Buying cargo rejected when 0 turns', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws: wsConn } = await ws(token);

    const adj = await getAdjacentSector(wsConn);
    await ensureSellingPort(pool, adj);
    await clearSectorFighters(adj);
    await wsRequest(wsConn, { type: ClientMsgType.Move, sector: adj }, ServerMsgType.MoveResult);
    await wsRequest(wsConn, { type: ClientMsgType.Dock }, ServerMsgType.DockResult);

    await pool.query('UPDATE players SET turns = 0 WHERE id = $1', [playerId]);
    const result = await wsRequest(wsConn, { type: ClientMsgType.PortTransaction, good: 'fuel', quantity: 1, action: 'buy' }, ServerMsgType.PortTransactionResult);
    assert.equal(result.type, ServerMsgType.Error);
    assert.match(result.message.toLowerCase(), /insufficient turns/);

    await closeWS(wsConn);
  });
});

// --- Sell cargo ---

describe('Sell cargo costs 0 turns', () => {
  it('Selling cargo costs 0 turns', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws: wsConn } = await ws(token);

    const adj = await getAdjacentSector(wsConn);
    await ensureBuyingPort(pool, adj);
    await clearSectorFighters(adj);
    await wsRequest(wsConn, { type: ClientMsgType.Move, sector: adj }, ServerMsgType.MoveResult);
    await pool.query('UPDATE ship_cargo SET fuel = 10 WHERE player_id = $1', [playerId]);
    await pool.query('UPDATE players SET turns = 50 WHERE id = $1', [playerId]);

    await wsRequest(wsConn, { type: ClientMsgType.Dock }, ServerMsgType.DockResult);
    const result = await wsRequest(wsConn, { type: ClientMsgType.PortTransaction, good: 'fuel', quantity: 1, action: 'sell' }, ServerMsgType.PortTransactionResult);
    assert.equal(result.type, ServerMsgType.PortTransactionResult);
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 50);

    await closeWS(wsConn);
  });
});

// --- Leave planet ---

describe('Leave planet turn costs', () => {
  it('Landing on a planet costs 0 turns', async () => {
    const { token, playerId } = await joinUniverse(pool);
    await pool.query('UPDATE players SET turns = 9999 WHERE id = $1', [playerId]);
    const { ws: wsConn } = await ws(token);

    const planetId = await ensurePlanetInSector(1);

    await pool.query('UPDATE players SET turns = 50 WHERE id = $1', [playerId]);
    await wsRequest(wsConn, { type: ClientMsgType.LandOnPlanet, planetId }, ServerMsgType.LandOnPlanetResult);
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 50);

    await closeWS(wsConn);
  });

  it('Leaving a planet costs 1 turn and includes turnsUsed', async () => {
    const { token, playerId } = await joinUniverse(pool);
    await pool.query('UPDATE players SET turns = 9999 WHERE id = $1', [playerId]);
    const { ws: wsConn } = await ws(token);

    const planetId = await ensurePlanetInSector(1);
    await wsRequest(wsConn, { type: ClientMsgType.LandOnPlanet, planetId }, ServerMsgType.LandOnPlanetResult);
    await pool.query('UPDATE players SET turns = 50 WHERE id = $1', [playerId]);

    const result = await wsRequest(wsConn, { type: ClientMsgType.LeavePlanet }, ServerMsgType.LeavePlanetResult);
    assert.equal(result.type, ServerMsgType.LeavePlanetResult);
    assert.equal(result.turnsUsed, 1);
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 49);

    await closeWS(wsConn);
  });

  it('Leaving planet rejected when 0 turns', async () => {
    const { token, playerId } = await joinUniverse(pool);
    await pool.query('UPDATE players SET turns = 9999 WHERE id = $1', [playerId]);
    const { ws: wsConn } = await ws(token);

    const planetId = await ensurePlanetInSector(1);
    await wsRequest(wsConn, { type: ClientMsgType.LandOnPlanet, planetId }, ServerMsgType.LandOnPlanetResult);
    await pool.query('UPDATE players SET turns = 0 WHERE id = $1', [playerId]);

    const result = await wsRequest(wsConn, { type: ClientMsgType.LeavePlanet }, ServerMsgType.LeavePlanetResult);
    assert.equal(result.type, ServerMsgType.Error);
    assert.match(result.message.toLowerCase(), /insufficient turns/);

    await closeWS(wsConn);
  });
});

// --- Buy holds ---

describe('Buy holds turn costs', () => {
  it('Buying holds costs 1 turn and includes turnsUsed', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws: wsConn } = await ws(token);
    await pool.query('UPDATE players SET turns = 50 WHERE id = $1', [playerId]);

    const result = await wsRequest(wsConn, { type: ClientMsgType.BuyHolds, quantity: 1 }, ServerMsgType.BuyHoldsResult);
    if (result.type === ServerMsgType.Error && !result.message.toLowerCase().includes('turns')) { await closeWS(wsConn); return; }
    assert.equal(result.type, ServerMsgType.BuyHoldsResult);
    assert.equal(result.turnsUsed, 1);
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 49);

    await closeWS(wsConn);
  });

  it('Buying holds rejected when 0 turns', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws: wsConn } = await ws(token);
    await pool.query('UPDATE players SET turns = 0 WHERE id = $1', [playerId]);

    const result = await wsRequest(wsConn, { type: ClientMsgType.BuyHolds, quantity: 1 }, ServerMsgType.BuyHoldsResult);
    if (result.type === ServerMsgType.Error && result.message.toLowerCase().includes('class 0')) { await closeWS(wsConn); return; }
    assert.equal(result.type, ServerMsgType.Error);
    assert.match(result.message.toLowerCase(), /insufficient turns/);

    await closeWS(wsConn);
  });
});

// --- Zero-cost actions ---

describe('Zero-cost actions', () => {
  it('Buying fighters costs 0 turns', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws: wsConn } = await ws(token);
    await pool.query('UPDATE players SET turns = 50 WHERE id = $1', [playerId]);
    await wsRequest(wsConn, { type: ClientMsgType.BuyFighters, quantity: 1 }, ServerMsgType.BuyFightersResult);
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 50);
    await closeWS(wsConn);
  });

  it('Buying shields costs 0 turns', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws: wsConn } = await ws(token);
    await pool.query('UPDATE players SET turns = 50 WHERE id = $1', [playerId]);
    await wsRequest(wsConn, { type: ClientMsgType.BuyShields, quantity: 1 }, ServerMsgType.BuyShieldsResult);
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 50);
    await closeWS(wsConn);
  });

  it('Jettisoning costs 0 turns', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws: wsConn } = await ws(token);
    await pool.query('UPDATE players SET turns = 50 WHERE id = $1', [playerId]);
    await wsRequest(wsConn, { type: ClientMsgType.Jettison }, ServerMsgType.JettisonResult);
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 50);
    await closeWS(wsConn);
  });

  it('Deploying fighters costs 0 turns', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws: wsConn } = await ws(token);
    await pool.query('UPDATE players SET turns = 50 WHERE id = $1', [playerId]);
    await pool.query('UPDATE player_ships SET fighters = 10 WHERE player_id = $1', [playerId]);
    await wsRequest(wsConn, { type: ClientMsgType.DeployFighters, quantity: 1 }, ServerMsgType.DeployFightersResult);
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 50);
    await pool.query('DELETE FROM sector_fighters WHERE owner_id = $1', [playerId]);
    await closeWS(wsConn);
  });
});

// --- Unlimited non-warp ---

describe('Unlimited universe - non-warp', () => {
  before(() => pool.query('UPDATE universes SET turns_per_day = 0 WHERE id = $1', [UNIVERSE_ID]));
  after(() => pool.query('UPDATE universes SET turns_per_day = 500 WHERE id = $1', [UNIVERSE_ID]));

  it('Unlimited: buying cargo turnsUsed = 0', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws: wsConn } = await ws(token);

    const adj = await getAdjacentSector(wsConn);
    await ensureSellingPort(pool, adj);
    await clearSectorFighters(adj);
    await wsRequest(wsConn, { type: ClientMsgType.Move, sector: adj }, ServerMsgType.MoveResult);
    await wsRequest(wsConn, { type: ClientMsgType.Dock }, ServerMsgType.DockResult);

    await pool.query('UPDATE players SET turns = 5 WHERE id = $1', [playerId]);
    const result = await wsRequest(wsConn, { type: ClientMsgType.PortTransaction, good: 'fuel', quantity: 1, action: 'buy' }, ServerMsgType.PortTransactionResult);
    assert.equal(result.type, ServerMsgType.PortTransactionResult);
    assert.equal(result.turnsUsed, 0);
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 5);

    await closeWS(wsConn);
  });

  it('Unlimited: leaving planet turnsUsed = 0', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws: wsConn } = await ws(token);

    const planetId = await ensurePlanetInSector(1);
    await wsRequest(wsConn, { type: ClientMsgType.LandOnPlanet, planetId }, ServerMsgType.LandOnPlanetResult);
    await pool.query('UPDATE players SET turns = 5 WHERE id = $1', [playerId]);

    const result = await wsRequest(wsConn, { type: ClientMsgType.LeavePlanet }, ServerMsgType.LeavePlanetResult);
    assert.equal(result.type, ServerMsgType.LeavePlanetResult);
    assert.equal(result.turnsUsed, 0);
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 5);

    await closeWS(wsConn);
  });

  it('Unlimited: buying holds turnsUsed = 0', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws: wsConn } = await ws(token);
    await pool.query('UPDATE players SET turns = 5 WHERE id = $1', [playerId]);

    const result = await wsRequest(wsConn, { type: ClientMsgType.BuyHolds, quantity: 1 }, ServerMsgType.BuyHoldsResult);
    if (result.type === ServerMsgType.Error && !result.message.toLowerCase().includes('turns')) { await closeWS(wsConn); return; }
    assert.equal(result.turnsUsed, 0);
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 5);

    await closeWS(wsConn);
  });

  it('Unlimited: buying cargo succeeds with 0 turns', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws: wsConn } = await ws(token);

    const adj = await getAdjacentSector(wsConn);
    await ensureSellingPort(pool, adj);
    await clearSectorFighters(adj);
    await wsRequest(wsConn, { type: ClientMsgType.Move, sector: adj }, ServerMsgType.MoveResult);
    await wsRequest(wsConn, { type: ClientMsgType.Dock }, ServerMsgType.DockResult);

    await pool.query('UPDATE players SET turns = 0 WHERE id = $1', [playerId]);
    const result = await wsRequest(wsConn, { type: ClientMsgType.PortTransaction, good: 'fuel', quantity: 1, action: 'buy' }, ServerMsgType.PortTransactionResult);
    assert.equal(result.type, ServerMsgType.PortTransactionResult);

    await closeWS(wsConn);
  });

  it('Unlimited: leaving planet succeeds with 0 turns', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws: wsConn } = await ws(token);

    const planetId = await ensurePlanetInSector(1);
    await wsRequest(wsConn, { type: ClientMsgType.LandOnPlanet, planetId }, ServerMsgType.LandOnPlanetResult);
    await pool.query('UPDATE players SET turns = 0 WHERE id = $1', [playerId]);

    const result = await wsRequest(wsConn, { type: ClientMsgType.LeavePlanet }, ServerMsgType.LeavePlanetResult);
    assert.equal(result.type, ServerMsgType.LeavePlanetResult);

    await closeWS(wsConn);
  });
});

// --- Grant turns script ---

describe('Grant turns script', () => {
  before(() => pool.query('UPDATE universes SET turns_per_day = 240, max_turns = 100 WHERE id = $1', [UNIVERSE_ID]));
  after(() => pool.query('UPDATE universes SET turns_per_day = 500, max_turns = 2000 WHERE id = $1', [UNIVERSE_ID]));

  it('Script runs without error and prints player count', () => {
    const output = execFileSync('node', ['scripts/grant-turns.js'], { cwd: PROJECT_ROOT, env: testEnv(), encoding: 'utf8' });
    assert.ok(typeof output === 'string');
    assert.match(output.trim(), /\d+/, 'Script must print the number of players updated');
  });

  it('Grants correct turns based on elapsed time', async () => {
    const { playerId } = await joinUniverse(pool);
    await pool.query(`UPDATE players SET turns = 10, last_turns_granted_at = NOW() - interval '3 hours' WHERE id = $1`, [playerId]);
    execFileSync('node', ['scripts/grant-turns.js'], { cwd: PROJECT_ROOT, env: testEnv(), encoding: 'utf8' });
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 40);
  });

  it('Caps turns at max_turns', async () => {
    const { playerId } = await joinUniverse(pool);
    await pool.query(`UPDATE players SET turns = 90, last_turns_granted_at = NOW() - interval '3 hours' WHERE id = $1`, [playerId]);
    execFileSync('node', ['scripts/grant-turns.js'], { cwd: PROJECT_ROOT, env: testEnv(), encoding: 'utf8' });
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 100);
  });

  it('Updates last_turns_granted_at', async () => {
    const { playerId } = await joinUniverse(pool);
    await pool.query(`UPDATE players SET last_turns_granted_at = NOW() - interval '2 hours' WHERE id = $1`, [playerId]);
    const beforeTime = new Date();
    execFileSync('node', ['scripts/grant-turns.js'], { cwd: PROJECT_ROOT, env: testEnv(), encoding: 'utf8' });
    const ts = new Date((await pool.query('SELECT last_turns_granted_at FROM players WHERE id = $1', [playerId])).rows[0].last_turns_granted_at);
    assert.ok(ts >= new Date(beforeTime.getTime() - 2000));
  });

  it('Skips unlimited universes', async () => {
    await pool.query('UPDATE universes SET turns_per_day = 0 WHERE id = $1', [UNIVERSE_ID]);
    const { playerId } = await joinUniverse(pool);
    await pool.query(`UPDATE players SET turns = 5, last_turns_granted_at = NOW() - interval '10 hours' WHERE id = $1`, [playerId]);
    execFileSync('node', ['scripts/grant-turns.js'], { cwd: PROJECT_ROOT, env: testEnv(), encoding: 'utf8' });
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 5);
    await pool.query('UPDATE universes SET turns_per_day = 240 WHERE id = $1', [UNIVERSE_ID]);
  });

  it('Grants 0 when less than 1 hour elapsed', async () => {
    const { playerId } = await joinUniverse(pool);
    await pool.query(`UPDATE players SET turns = 20, last_turns_granted_at = NOW() - interval '30 minutes' WHERE id = $1`, [playerId]);
    execFileSync('node', ['scripts/grant-turns.js'], { cwd: PROJECT_ROOT, env: testEnv(), encoding: 'utf8' });
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 20);
  });

  it('Does not update last_turns_granted_at when 0 turns granted', async () => {
    const { playerId } = await joinUniverse(pool);
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
    await pool.query(`UPDATE players SET turns = 20, last_turns_granted_at = $1 WHERE id = $2`, [thirtyMinAgo, playerId]);

    execFileSync('node', ['scripts/grant-turns.js'], { cwd: PROJECT_ROOT, env: testEnv(), encoding: 'utf8' });

    const ts = new Date((await pool.query('SELECT last_turns_granted_at FROM players WHERE id = $1', [playerId])).rows[0].last_turns_granted_at);
    assert.ok(Math.abs(ts.getTime() - thirtyMinAgo.getTime()) < 5000,
      `last_turns_granted_at should be preserved when 0 turns granted, but was updated to ${ts.toISOString()}`);
  });

  it('Boundary: 59m59s gets 0 turns, exactly 60m gets hourly rate', async () => {
    const { playerId: pUnder } = await joinUniverse(pool);
    const { playerId: pExact } = await joinUniverse(pool);
    await pool.query(`UPDATE players SET turns = 0, last_turns_granted_at = NOW() - interval '59 minutes 59 seconds' WHERE id = $1`, [pUnder]);
    await pool.query(`UPDATE players SET turns = 0, last_turns_granted_at = NOW() - interval '60 minutes' WHERE id = $1`, [pExact]);

    execFileSync('node', ['scripts/grant-turns.js'], { cwd: PROJECT_ROOT, env: testEnv(), encoding: 'utf8' });

    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [pUnder])).rows[0].turns, 0);
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [pExact])).rows[0].turns, 10);
  });

  it('Double-run: second run grants 0 additional turns', async () => {
    const { playerId } = await joinUniverse(pool);
    await pool.query(`UPDATE players SET turns = 0, last_turns_granted_at = NOW() - interval '2 hours' WHERE id = $1`, [playerId]);

    execFileSync('node', ['scripts/grant-turns.js'], { cwd: PROJECT_ROOT, env: testEnv(), encoding: 'utf8' });
    const turnsAfterFirst = (await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns;
    assert.equal(turnsAfterFirst, 20);

    execFileSync('node', ['scripts/grant-turns.js'], { cwd: PROJECT_ROOT, env: testEnv(), encoding: 'utf8' });
    const turnsAfterSecond = (await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns;
    assert.equal(turnsAfterSecond, 20);
  });

  it('Fractional hours: 2h50m grants only 2 hours worth', async () => {
    const { playerId } = await joinUniverse(pool);
    await pool.query(`UPDATE players SET turns = 5, last_turns_granted_at = NOW() - interval '2 hours 50 minutes' WHERE id = $1`, [playerId]);
    execFileSync('node', ['scripts/grant-turns.js'], { cwd: PROJECT_ROOT, env: testEnv(), encoding: 'utf8' });
    assert.equal((await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns, 25);
  });

  it('Concurrent runs do not double-grant turns', async () => {
    const { playerId } = await joinUniverse(pool);
    await pool.query(`UPDATE players SET turns = 0, last_turns_granted_at = NOW() - interval '2 hours' WHERE id = $1`, [playerId]);

    const runGrant = () => new Promise((resolve, reject) => {
      const proc = spawn('node', ['scripts/grant-turns.js'], {
        cwd: PROJECT_ROOT, env: testEnv(), stdio: 'pipe',
      });
      let out = '';
      proc.stdout.on('data', (d) => { out += d; });
      proc.stderr.on('data', (d) => { out += d; });
      const killTimer = setTimeout(() => { proc.kill(); }, 10000);
      proc.on('close', (code) => { clearTimeout(killTimer); resolve({ code, out }); });
      proc.on('error', (err) => { clearTimeout(killTimer); reject(err); });
    });

    const [r1, r2] = await Promise.all([runGrant(), runGrant()]);
    assert.equal(r1.code, 0);
    assert.equal(r2.code, 0);

    const turns = (await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns;
    assert.equal(turns, 20, `Expected 20 turns (one grant of 2h * 10/h), got ${turns} — possible missing row lock`);
  });
});

// ============================================================
// HYPERSPACE JUMP SYSTEM TESTS
// ============================================================

// --- Ship config: canHaveHyperwarp ---

describe('Ship configs - canHaveHyperwarp', () => {
  it('Merchant Freighter has canHaveHyperwarp = false', () => {
    const cfg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'ships', 'merchant.json'), 'utf8'));
    assert.strictEqual(cfg.canHaveHyperwarp, false);
  });

  it('Scout Marauder has canHaveHyperwarp = true', () => {
    const cfg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'ships', 'scout.json'), 'utf8'));
    assert.strictEqual(cfg.canHaveHyperwarp, true);
  });

  it('All ships follow the maxFighters >= 10 rule (except Merchant and Scout)', () => {
    const files = readdirSync(join(PROJECT_ROOT, 'config', 'ships')).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const cfg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'ships', file), 'utf8'));
      assert.ok(typeof cfg.canHaveHyperwarp === 'boolean', `${file}: missing canHaveHyperwarp`);
      if (cfg.name === 'Merchant Freighter' || cfg.name === 'Scout Marauder') continue;
      const expected = cfg.maxFighters >= 10;
      assert.strictEqual(cfg.canHaveHyperwarp, expected,
        `${file}: canHaveHyperwarp should be ${expected} (maxFighters=${cfg.maxFighters})`);
    }
  });
});

// --- Schema: has_hyperwarp_drive ---

describe('Schema - has_hyperwarp_drive', () => {
  it('player_ships.has_hyperwarp_drive exists (boolean, NOT NULL, default false)', async () => {
    const res = await pool.query(`
      SELECT data_type, column_default, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'player_ships' AND column_name = 'has_hyperwarp_drive'
    `);
    assert.equal(res.rows.length, 1);
    assert.match(res.rows[0].data_type, /bool/i);
    assert.equal(res.rows[0].is_nullable, 'NO');
    assert.match(res.rows[0].column_default, /false/i);
  });
});

// --- BuyHyperwarpDrive ---

describe('BuyHyperwarpDrive', () => {
  it('Successfully buys hyperwarp drive at Stardock', async () => {
    const { ws: wsConn, playerId } = await goToStardock(pool);
    const shipRes = await pool.query('SELECT ship_name FROM player_ships WHERE player_id = $1', [playerId]);
    const shipName = shipRes.rows[0].ship_name;
    const cfgFiles = readdirSync(join(PROJECT_ROOT, 'config', 'ships')).filter(f => f.endsWith('.json'));
    let canEquip = false;
    for (const file of cfgFiles) {
      const cfg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'ships', file), 'utf8'));
      if (cfg.name === shipName) { canEquip = cfg.canHaveHyperwarp; break; }
    }

    if (!canEquip) {
      await pool.query("UPDATE player_ships SET ship_name = 'Scout Marauder' WHERE player_id = $1", [playerId]);
    }

    await pool.query('UPDATE ship_cargo SET credits = 100000 WHERE player_id = $1', [playerId]);
    await pool.query('UPDATE player_ships SET has_hyperwarp_drive = false WHERE player_id = $1', [playerId]);

    const result = await wsRequest(wsConn, { type: ClientMsgType.BuyHyperwarpDrive }, ServerMsgType.BuyHyperwarpDriveResult);
    assert.equal(result.type, ServerMsgType.BuyHyperwarpDriveResult);

    const driveRes = await pool.query('SELECT has_hyperwarp_drive FROM player_ships WHERE player_id = $1', [playerId]);
    assert.equal(driveRes.rows[0].has_hyperwarp_drive, true);

    const creditsRes = await pool.query('SELECT credits FROM ship_cargo WHERE player_id = $1', [playerId]);
    assert.equal(creditsRes.rows[0].credits, 50000);

    await closeWS(wsConn);
  });

  it('Rejected when not at Stardock', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws: wsConn } = await ws(token);
    await pool.query("UPDATE player_ships SET ship_name = 'Scout Marauder', has_hyperwarp_drive = false WHERE player_id = $1", [playerId]);
    await pool.query('UPDATE ship_cargo SET credits = 100000 WHERE player_id = $1', [playerId]);

    const result = await wsRequest(wsConn, { type: ClientMsgType.BuyHyperwarpDrive }, ServerMsgType.BuyHyperwarpDriveResult);
    assert.equal(result.type, ServerMsgType.Error);

    await closeWS(wsConn);
  });

  it('Rejected when ship cannot equip hyperwarp', async () => {
    const { ws: wsConn, playerId } = await goToStardock(pool);
    await pool.query("UPDATE player_ships SET ship_name = 'Merchant Freighter' WHERE player_id = $1", [playerId]);
    await pool.query('UPDATE ship_cargo SET credits = 100000 WHERE player_id = $1', [playerId]);

    const result = await wsRequest(wsConn, { type: ClientMsgType.BuyHyperwarpDrive }, ServerMsgType.BuyHyperwarpDriveResult);
    assert.equal(result.type, ServerMsgType.Error);
    assert.match(result.message.toLowerCase(), /incapable/);

    await closeWS(wsConn);
  });

  it('Rejected when already have hyperwarp drive', async () => {
    const { ws: wsConn, playerId } = await goToStardock(pool);
    await pool.query("UPDATE player_ships SET ship_name = 'Scout Marauder', has_hyperwarp_drive = true WHERE player_id = $1", [playerId]);
    await pool.query('UPDATE ship_cargo SET credits = 100000 WHERE player_id = $1', [playerId]);

    const result = await wsRequest(wsConn, { type: ClientMsgType.BuyHyperwarpDrive }, ServerMsgType.BuyHyperwarpDriveResult);
    assert.equal(result.type, ServerMsgType.Error);
    assert.match(result.message.toLowerCase(), /already/);

    await closeWS(wsConn);
  });

  it('Rejected when insufficient credits', async () => {
    const { ws: wsConn, playerId } = await goToStardock(pool);
    await pool.query("UPDATE player_ships SET ship_name = 'Scout Marauder', has_hyperwarp_drive = false WHERE player_id = $1", [playerId]);
    await pool.query('UPDATE ship_cargo SET credits = 100 WHERE player_id = $1', [playerId]);

    const result = await wsRequest(wsConn, { type: ClientMsgType.BuyHyperwarpDrive }, ServerMsgType.BuyHyperwarpDriveResult);
    assert.equal(result.type, ServerMsgType.Error);
    assert.match(result.message.toLowerCase(), /credits/);

    await closeWS(wsConn);
  });

  it('Buying hyperwarp drive costs 0 turns', async () => {
    const { ws: wsConn, playerId } = await goToStardock(pool);
    await pool.query("UPDATE player_ships SET ship_name = 'Scout Marauder', has_hyperwarp_drive = false WHERE player_id = $1", [playerId]);
    await pool.query('UPDATE ship_cargo SET credits = 100000 WHERE player_id = $1', [playerId]);
    await pool.query('UPDATE players SET turns = 50 WHERE id = $1', [playerId]);

    await wsRequest(wsConn, { type: ClientMsgType.BuyHyperwarpDrive }, ServerMsgType.BuyHyperwarpDriveResult);
    const turnsAfter = (await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns;
    assert.equal(turnsAfter, 50);

    await closeWS(wsConn);
  });
});

// --- ListDeployedFighters ---

describe('ListDeployedFighters', () => {
  it('Returns deployed fighters for the player', async () => {
    const { token, playerId } = await joinUniverse(pool);
    await pool.query('UPDATE players SET turns = 9999 WHERE id = $1', [playerId]);
    const { ws: wsConn } = await ws(token);

    await deployFightersInSector(pool, playerId, 5, 10);
    await deployFightersInSector(pool, playerId, 15, 20);

    const result = await wsRequest(wsConn, { type: ClientMsgType.ListDeployedFighters }, ServerMsgType.ListDeployedFightersResult);
    assert.equal(result.type, ServerMsgType.ListDeployedFightersResult);
    assert.ok(Array.isArray(result.fighters));

    const s5 = result.fighters.find(f => f.sectorId === 5);
    const s15 = result.fighters.find(f => f.sectorId === 15);
    assert.ok(s5, 'Should include sector 5');
    assert.equal(s5.quantity, 10);
    assert.ok(s15, 'Should include sector 15');
    assert.equal(s15.quantity, 20);

    await pool.query('DELETE FROM sector_fighters WHERE owner_id = $1', [playerId]);
    await closeWS(wsConn);
  });

  it('Returns empty array when no fighters deployed', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws: wsConn } = await ws(token);

    await pool.query('DELETE FROM sector_fighters WHERE owner_id = $1', [playerId]);

    const result = await wsRequest(wsConn, { type: ClientMsgType.ListDeployedFighters }, ServerMsgType.ListDeployedFightersResult);
    assert.equal(result.type, ServerMsgType.ListDeployedFightersResult);
    assert.ok(Array.isArray(result.fighters));
    assert.equal(result.fighters.length, 0);

    await closeWS(wsConn);
  });

  it('Does not include other players fighters', async () => {
    const { token: token1 } = await joinUniverse(pool);
    const { playerId: p2 } = await joinUniverse(pool);
    const { ws: wsConn } = await ws(token1);

    await deployFightersInSector(pool, p2, 50, 10);

    const result = await wsRequest(wsConn, { type: ClientMsgType.ListDeployedFighters }, ServerMsgType.ListDeployedFightersResult);
    assert.equal(result.type, ServerMsgType.ListDeployedFightersResult);
    const found = result.fighters.find(f => f.sectorId === 50);
    assert.ok(!found, 'Should not include other player fighters');

    await pool.query('DELETE FROM sector_fighters WHERE owner_id = $1', [p2]);
    await closeWS(wsConn);
  });

  it('Costs 0 turns', async () => {
    const { token, playerId } = await joinUniverse(pool);
    const { ws: wsConn } = await ws(token);
    await pool.query('UPDATE players SET turns = 50 WHERE id = $1', [playerId]);

    await wsRequest(wsConn, { type: ClientMsgType.ListDeployedFighters }, ServerMsgType.ListDeployedFightersResult);
    const turnsAfter = (await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns;
    assert.equal(turnsAfter, 50);

    await closeWS(wsConn);
  });
});

// --- HyperspaceJump ---

describe('HyperspaceJump', () => {
  async function setupJumpPlayer() {
    const { token, playerId } = await joinUniverse(pool);
    await pool.query('UPDATE players SET turns = 9999 WHERE id = $1', [playerId]);
    await pool.query("UPDATE player_ships SET ship_name = 'Scout Marauder', has_hyperwarp_drive = true, turns_per_warp = 2 WHERE player_id = $1", [playerId]);
    const { ws: wsConn } = await ws(token);
    return { ws: wsConn, token, playerId };
  }

  async function findDistantSector(wsConn, minHops = 2) {
    const disp = await wsRequest(wsConn, { type: ClientMsgType.SectorDisplay }, ServerMsgType.SectorDisplayResult);
    const currentSector = disp.sector;

    for (let target = 2; target <= 100; target++) {
      if (target === currentSector) continue;
      const pathRes = await wsRequest(wsConn, { type: ClientMsgType.ShortestPath, from: currentSector, to: target }, ServerMsgType.ShortestPathResult);
      if (pathRes.type !== ServerMsgType.Error && pathRes.hops >= minHops) {
        return { targetSector: target, hops: pathRes.hops, currentSector };
      }
    }
    throw new Error('Could not find a distant sector');
  }

  it('Successful hyperspace jump deducts fuel and turns, moves player', async () => {
    const { ws: wsConn, playerId } = await setupJumpPlayer();
    const { targetSector, hops } = await findDistantSector(wsConn);
    const fuelCost = hops * 3;

    await deployFightersInSector(pool, playerId, targetSector, 5);
    await pool.query('UPDATE ship_cargo SET fuel = $1 WHERE player_id = $2', [fuelCost + 10, playerId]);
    await pool.query('UPDATE players SET turns = 100 WHERE id = $1', [playerId]);

    const tpw = (await pool.query('SELECT turns_per_warp FROM player_ships WHERE player_id = $1', [playerId])).rows[0].turns_per_warp;

    const result = await wsRequest(wsConn, { type: ClientMsgType.HyperspaceJump, targetSector }, ServerMsgType.HyperspaceJumpResult);
    assert.equal(result.type, ServerMsgType.HyperspaceJumpResult);
    assert.equal(result.targetSector, targetSector);
    assert.equal(result.fuelUsed, fuelCost);
    assert.equal(result.turnsUsed, tpw);

    const fuelAfter = (await pool.query('SELECT fuel FROM ship_cargo WHERE player_id = $1', [playerId])).rows[0].fuel;
    assert.equal(fuelAfter, fuelCost + 10 - fuelCost);

    const turnsAfter = (await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns;
    assert.equal(turnsAfter, 100 - tpw);

    const sectorDisp = await wsRequest(wsConn, { type: ClientMsgType.SectorDisplay }, ServerMsgType.SectorDisplayResult);
    assert.equal(sectorDisp.sector, targetSector);

    await pool.query('DELETE FROM sector_fighters WHERE owner_id = $1', [playerId]);
    await closeWS(wsConn);
  });

  it('Rejected when no hyperwarp drive', async () => {
    const { token, playerId } = await joinUniverse(pool);
    await pool.query('UPDATE players SET turns = 9999 WHERE id = $1', [playerId]);
    await pool.query('UPDATE player_ships SET has_hyperwarp_drive = false WHERE player_id = $1', [playerId]);
    const { ws: wsConn } = await ws(token);

    const adj = await getAdjacentSector(wsConn);
    await deployFightersInSector(pool, playerId, adj, 5);

    const result = await wsRequest(wsConn, { type: ClientMsgType.HyperspaceJump, targetSector: adj }, ServerMsgType.HyperspaceJumpResult);
    assert.equal(result.type, ServerMsgType.Error);
    assert.match(result.message.toLowerCase(), /not equipped/);

    await pool.query('DELETE FROM sector_fighters WHERE owner_id = $1', [playerId]);
    await closeWS(wsConn);
  });

  it('Rejected when no fighter in target sector', async () => {
    const { ws: wsConn, playerId } = await setupJumpPlayer();
    const adj = await getAdjacentSector(wsConn);

    await pool.query('DELETE FROM sector_fighters WHERE sector_id = $1 AND owner_id = $2', [adj, playerId]);
    await pool.query('UPDATE ship_cargo SET fuel = 100 WHERE player_id = $1', [playerId]);

    const result = await wsRequest(wsConn, { type: ClientMsgType.HyperspaceJump, targetSector: adj }, ServerMsgType.HyperspaceJumpResult);
    assert.equal(result.type, ServerMsgType.Error);
    assert.match(result.message.toLowerCase(), /no signal/);

    await closeWS(wsConn);
  });

  it('Rejected when insufficient fuel', async () => {
    const { ws: wsConn, playerId } = await setupJumpPlayer();
    const { targetSector, hops } = await findDistantSector(wsConn);
    const fuelCost = hops * 3;

    await deployFightersInSector(pool, playerId, targetSector, 5);
    await pool.query('UPDATE ship_cargo SET fuel = $1 WHERE player_id = $2', [fuelCost - 1, playerId]);

    const result = await wsRequest(wsConn, { type: ClientMsgType.HyperspaceJump, targetSector }, ServerMsgType.HyperspaceJumpResult);
    assert.equal(result.type, ServerMsgType.Error);
    assert.match(result.message.toLowerCase(), /fuel/);

    await pool.query('DELETE FROM sector_fighters WHERE owner_id = $1', [playerId]);
    await closeWS(wsConn);
  });

  it('Rejected when insufficient turns', async () => {
    const { ws: wsConn, playerId } = await setupJumpPlayer();
    const { targetSector, hops } = await findDistantSector(wsConn);
    const fuelCost = hops * 3;

    await deployFightersInSector(pool, playerId, targetSector, 5);
    await pool.query('UPDATE ship_cargo SET fuel = $1 WHERE player_id = $2', [fuelCost + 10, playerId]);
    await pool.query('UPDATE players SET turns = 0 WHERE id = $1', [playerId]);

    const result = await wsRequest(wsConn, { type: ClientMsgType.HyperspaceJump, targetSector }, ServerMsgType.HyperspaceJumpResult);
    assert.equal(result.type, ServerMsgType.Error);
    assert.match(result.message.toLowerCase(), /turns/);

    await pool.query('DELETE FROM sector_fighters WHERE owner_id = $1', [playerId]);
    await closeWS(wsConn);
  });

  it('Fuel cost is correctly calculated as hops * 3', async () => {
    const { ws: wsConn, playerId } = await setupJumpPlayer();
    const { targetSector, hops } = await findDistantSector(wsConn, 3);
    const expectedFuelCost = hops * 3;

    await deployFightersInSector(pool, playerId, targetSector, 5);
    await pool.query('UPDATE ship_cargo SET fuel = $1 WHERE player_id = $2', [1000, playerId]);
    await pool.query('UPDATE players SET turns = 100 WHERE id = $1', [playerId]);

    const result = await wsRequest(wsConn, { type: ClientMsgType.HyperspaceJump, targetSector }, ServerMsgType.HyperspaceJumpResult);
    assert.equal(result.type, ServerMsgType.HyperspaceJumpResult);
    assert.equal(result.fuelUsed, expectedFuelCost);

    const fuelAfter = (await pool.query('SELECT fuel FROM ship_cargo WHERE player_id = $1', [playerId])).rows[0].fuel;
    assert.equal(fuelAfter, 1000 - expectedFuelCost);

    await pool.query('DELETE FROM sector_fighters WHERE owner_id = $1', [playerId]);
    await closeWS(wsConn);
  });

  it('In unlimited universe, turnsUsed = 0 and no turn deduction', async () => {
    await pool.query('UPDATE universes SET turns_per_day = 0 WHERE id = $1', [UNIVERSE_ID]);
    try {
      const { ws: wsConn, playerId } = await setupJumpPlayer();
      const { targetSector, hops } = await findDistantSector(wsConn);
      const fuelCost = hops * 3;

      await deployFightersInSector(pool, playerId, targetSector, 5);
      await pool.query('UPDATE ship_cargo SET fuel = $1 WHERE player_id = $2', [fuelCost + 10, playerId]);
      await pool.query('UPDATE players SET turns = 10 WHERE id = $1', [playerId]);

      const result = await wsRequest(wsConn, { type: ClientMsgType.HyperspaceJump, targetSector }, ServerMsgType.HyperspaceJumpResult);
      assert.equal(result.type, ServerMsgType.HyperspaceJumpResult);
      assert.equal(result.turnsUsed, 0);

      const turnsAfter = (await pool.query('SELECT turns FROM players WHERE id = $1', [playerId])).rows[0].turns;
      assert.equal(turnsAfter, 10);

      await pool.query('DELETE FROM sector_fighters WHERE owner_id = $1', [playerId]);
      await closeWS(wsConn);
    } finally {
      await pool.query('UPDATE universes SET turns_per_day = 500 WHERE id = $1', [UNIVERSE_ID]);
    }
  });

  it('In unlimited universe, jump succeeds even with 0 turns', async () => {
    await pool.query('UPDATE universes SET turns_per_day = 0 WHERE id = $1', [UNIVERSE_ID]);
    try {
      const { ws: wsConn, playerId } = await setupJumpPlayer();
      const adj = await getAdjacentSector(wsConn);
      await deployFightersInSector(pool, playerId, adj, 5);
      await pool.query('UPDATE ship_cargo SET fuel = 100 WHERE player_id = $1', [playerId]);
      await pool.query('UPDATE players SET turns = 0 WHERE id = $1', [playerId]);

      const result = await wsRequest(wsConn, { type: ClientMsgType.HyperspaceJump, targetSector: adj }, ServerMsgType.HyperspaceJumpResult);
      assert.equal(result.type, ServerMsgType.HyperspaceJumpResult);
      assert.equal(result.turnsUsed, 0);

      await pool.query('DELETE FROM sector_fighters WHERE owner_id = $1', [playerId]);
      await closeWS(wsConn);
    } finally {
      await pool.query('UPDATE universes SET turns_per_day = 500 WHERE id = $1', [UNIVERSE_ID]);
    }
  });

  it('Rejected when player is docked at a port', async () => {
    const { ws: wsConn, playerId } = await setupJumpPlayer();
    const adj = await getAdjacentSector(wsConn);
    await ensureSellingPort(pool, adj);
    await clearSectorFighters(adj);
    await deployFightersInSector(pool, playerId, adj, 5);
    await pool.query('UPDATE ship_cargo SET fuel = 100 WHERE player_id = $1', [playerId]);

    await wsRequest(wsConn, { type: ClientMsgType.Move, sector: adj }, ServerMsgType.MoveResult);
    await wsRequest(wsConn, { type: ClientMsgType.Dock }, ServerMsgType.DockResult);

    const adj2 = await getAdjacentSector(wsConn);
    if (adj2) {
      await deployFightersInSector(pool, playerId, adj2, 5);
      const result = await wsRequest(wsConn, { type: ClientMsgType.HyperspaceJump, targetSector: adj2 }, ServerMsgType.HyperspaceJumpResult);
      assert.equal(result.type, ServerMsgType.Error);
    }

    await pool.query('DELETE FROM sector_fighters WHERE owner_id = $1', [playerId]);
    await closeWS(wsConn);
  });

  it('Rejected when player is at Stardock', async () => {
    const { ws: wsConn, playerId } = await goToStardock(pool);
    await pool.query('UPDATE ship_cargo SET fuel = 100 WHERE player_id = $1', [playerId]);

    const adj = await getAdjacentSector(wsConn);
    if (adj) {
      await deployFightersInSector(pool, playerId, adj, 5);
      const result = await wsRequest(wsConn, { type: ClientMsgType.HyperspaceJump, targetSector: adj }, ServerMsgType.HyperspaceJumpResult);
      assert.equal(result.type, ServerMsgType.Error);
      await pool.query('DELETE FROM sector_fighters WHERE owner_id = $1', [playerId]);
    }

    await closeWS(wsConn);
  });

  it('Rejected when player is on a planet', async () => {
    const { ws: wsConn, playerId } = await setupJumpPlayer();

    const planetId = await ensurePlanetInSector(1);

    await wsRequest(wsConn, { type: ClientMsgType.LandOnPlanet, planetId }, ServerMsgType.LandOnPlanetResult);
    await pool.query('UPDATE ship_cargo SET fuel = 100 WHERE player_id = $1', [playerId]);

    const adj = await getAdjacentSector(wsConn);
    if (adj) {
      await deployFightersInSector(pool, playerId, adj, 5);
      const result = await wsRequest(wsConn, { type: ClientMsgType.HyperspaceJump, targetSector: adj }, ServerMsgType.HyperspaceJumpResult);
      assert.equal(result.type, ServerMsgType.Error);
      await pool.query('DELETE FROM sector_fighters WHERE owner_id = $1', [playerId]);
    }

    await closeWS(wsConn);
  });

  it('Rejected when no path to target sector', async () => {
    const { ws: wsConn, playerId } = await setupJumpPlayer();

    const fakeSector = 99999;
    await pool.query(`INSERT INTO sectors (id, universe_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [fakeSector, UNIVERSE_ID]);
    await deployFightersInSector(pool, playerId, fakeSector, 5);
    await pool.query('UPDATE ship_cargo SET fuel = 1000 WHERE player_id = $1', [playerId]);

    const result = await wsRequest(wsConn, { type: ClientMsgType.HyperspaceJump, targetSector: fakeSector }, ServerMsgType.HyperspaceJumpResult);
    assert.equal(result.type, ServerMsgType.Error);
    assert.match(result.message.toLowerCase(), /no path/);

    await pool.query('DELETE FROM sector_fighters WHERE owner_id = $1', [playerId]);
    await pool.query('DELETE FROM sectors WHERE id = $1 AND universe_id = $2', [fakeSector, UNIVERSE_ID]);
    await closeWS(wsConn);
  });
});

// --- ListDeployedFighters state checks ---

describe('ListDeployedFighters - sector command mode', () => {
  it('Rejected when player is docked at a port', async () => {
    const { token, playerId } = await joinUniverse(pool);
    await pool.query('UPDATE players SET turns = 9999 WHERE id = $1', [playerId]);
    const { ws: wsConn } = await ws(token);

    const adj = await getAdjacentSector(wsConn);
    await ensureSellingPort(pool, adj);
    await clearSectorFighters(adj);
    await wsRequest(wsConn, { type: ClientMsgType.Move, sector: adj }, ServerMsgType.MoveResult);
    await wsRequest(wsConn, { type: ClientMsgType.Dock }, ServerMsgType.DockResult);

    const result = await wsRequest(wsConn, { type: ClientMsgType.ListDeployedFighters }, ServerMsgType.ListDeployedFightersResult);
    assert.equal(result.type, ServerMsgType.Error);

    await closeWS(wsConn);
  });

  it('Rejected when player is at Stardock', async () => {
    const { ws: wsConn } = await goToStardock(pool);

    const result = await wsRequest(wsConn, { type: ClientMsgType.ListDeployedFighters }, ServerMsgType.ListDeployedFightersResult);
    assert.equal(result.type, ServerMsgType.Error);

    await closeWS(wsConn);
  });

  it('Rejected when player is on a planet', async () => {
    const { token, playerId } = await joinUniverse(pool);
    await pool.query('UPDATE players SET turns = 9999 WHERE id = $1', [playerId]);
    const { ws: wsConn } = await ws(token);

    const planetId = await ensurePlanetInSector(1);
    await wsRequest(wsConn, { type: ClientMsgType.LandOnPlanet, planetId }, ServerMsgType.LandOnPlanetResult);

    const result = await wsRequest(wsConn, { type: ClientMsgType.ListDeployedFighters }, ServerMsgType.ListDeployedFightersResult);
    assert.equal(result.type, ServerMsgType.Error);

    await closeWS(wsConn);
  });
});

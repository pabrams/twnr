import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectWS as _connectWS, closeWS, wsRequest } from './helpers.mjs';
import { ensureServer, createPool } from './global-setup.mjs';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = join(dirname(__filename), '..');

const UNIVERSE_ID = 1;

async function navigateTo(ws, targetSector) {
  const disp = await wsRequest(ws, { type: 'sectorDisplay' }, 'sectorDisplayResult');
  if (disp.sector === targetSector) return;
  const path = await wsRequest(ws, { type: 'path', from: disp.sector, to: targetSector }, 'shortestPathResult');
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

async function findFuelBuyerSector() {
  const res = await pool.query('SELECT sector_id FROM ports WHERE class IN (1, 2, 5, 8) AND universe_id = $1 LIMIT 1', [UNIVERSE_ID]);
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

describe('Movement Constraint', () => {
  it('WebSocket move without a ship row returns { type: "noShip" }', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      await pool.query('DELETE FROM player_ships WHERE player_id = $1', [playerId]);

      const adjRes = await pool.query('SELECT sector_to FROM warps WHERE sector_from = 1 AND universe_id = $1 LIMIT 1', [UNIVERSE_ID]);
      const target = adjRes.rows.length > 0 ? Number(adjRes.rows[0].sector_to) : 2;

      const msg = await wsRequest(ws, { type: 'move', sector: target }, 'moveResult');
      assert.equal(msg.type, 'moveResult');
      assert.equal(msg.outcome, 'noShip');
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

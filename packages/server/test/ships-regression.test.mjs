import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { connectWS as _connectWS, closeWS, wsRequest } from './helpers.mjs';
import { ensureServer, createPool } from './global-setup.mjs';
import { ClientMsgType, ServerMsgType } from '@twnr/shared';


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

async function findFuelBuyerSector() {
  const res = await pool.query('SELECT s.sector_number AS sector_id FROM ports p JOIN sectors s ON p.sector_id = s.id WHERE p.class IN (1, 2, 5, 8) AND s.universe_id = $1 LIMIT 1', [UNIVERSE_ID]);
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

      const adjRes = await pool.query('SELECT s_to.sector_number AS sector_to FROM warps w JOIN sectors s_from ON w.from_sector_id = s_from.id JOIN sectors s_to ON w.to_sector_id = s_to.id WHERE s_from.sector_number = 1 AND s_from.universe_id = $1 LIMIT 1', [UNIVERSE_ID]);
      const target = adjRes.rows.length > 0 ? Number(adjRes.rows[0].sector_to) : 2;

      const msg = await wsRequest(ws, { type: ClientMsgType.Move, sector: target }, ServerMsgType.MoveResult);
      assert.equal(msg.type, ServerMsgType.MoveResult);
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
      const msg = await wsRequest(ws, { type: ClientMsgType.PortTransaction, good: 'fuel', quantity: 2, action: 'sell' }, ServerMsgType.PortTransactionResult);
      assert.equal(msg.type,  ServerMsgType.PortTransactionResult);
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

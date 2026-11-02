import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createTestUser, createTestPlayer, connectWS, closeWS, wsRequest } from './helpers.mjs';
import { ensureServer, createPool, WS_BASE } from './global-setup.mjs';
import { Commands } from '@twnr/shared';

const UNIVERSE_ID = 1;
const OBSERVED_SECTOR = 3;
const START_SECTOR = 1;

let pool;

async function createPlayer(name, sector, drones = 0) {
  const { userId, token } = await createTestUser(pool);
  const playerId = await createTestPlayer(pool, userId, UNIVERSE_ID, name, sector, drones, 0);
  return { id: playerId, token };
}

function connectExpectingClose(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}/ws?universe=${UNIVERSE_ID}`, {
      headers: { Cookie: `twnr_auth=${token}` },
    });
    ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    ws.on('error', reject);
  });
}

async function destroyByAttack(attacker, defender) {
  const { ws: attackerWs, ready } = await connectWS({ token: attacker.token, universeId: UNIVERSE_ID });
  const { ws: defenderWs } = await connectWS({ token: defender.token, universeId: UNIVERSE_ID });
  await ready;
  try {
    await wsRequest(attackerWs, { type: Commands.AttackShip.name, targetPlayerId: defender.id, drones: 1 }, Commands.AttackShip.reply.name);
  } finally {
    await closeWS(attackerWs);
    await closeWS(defenderWs);
  }
}

before(async () => {
  await ensureServer();
  pool = createPool();
});

after(async () => {
  if (pool) await pool.end();
});

describe('Reconnecting after ship destruction', () => {
  it('is told to wait for respawn, not that the player is missing', async () => {
    const attacker = await createPlayer(`rsp_atk_${Date.now()}`, OBSERVED_SECTOR, 5);
    const defender = await createPlayer(`rsp_def_${Date.now()}`, OBSERVED_SECTOR);
    await destroyByAttack(attacker, defender);

    const closed = await connectExpectingClose(defender.token);
    assert.equal(closed.code, 1008);
    assert.match(closed.reason, /^Ship destroyed; respawn in \d+s$/);
  });

  it('respawns at the starting sector once the delay has elapsed', async () => {
    const attacker = await createPlayer(`rsp2_atk_${Date.now()}`, OBSERVED_SECTOR, 5);
    const defender = await createPlayer(`rsp2_def_${Date.now()}`, OBSERVED_SECTOR);
    const observer = await createPlayer(`rsp2_obs_${Date.now()}`, START_SECTOR);
    await destroyByAttack(attacker, defender);
    await pool.query(`UPDATE players SET ship_destroyed_date = NOW() - INTERVAL '10 years' WHERE id = $1`, [defender.id]);

    const { ws: observerWs, ready } = await connectWS({ token: observer.token, universeId: UNIVERSE_ID });
    await ready;
    const { ws: defenderWs, welcome } = await connectWS({ token: defender.token, universeId: UNIVERSE_ID });
    try {
      assert.equal(welcome.sector, START_SECTOR);
      assert.ok(welcome.shipTypeName, 'respawned player is issued a ship');

      const row = await pool.query('SELECT current_sector_id FROM players WHERE id = $1', [defender.id]);
      assert.notEqual(row.rows[0].current_sector_id, null);

      const display = await wsRequest(observerWs, { type: Commands.SectorDisplay.name }, Commands.SectorDisplay.reply.name);
      assert.ok(display.players.some((p) => p.id === defender.id), 'respawned player is back in the starting sector');
    } finally {
      await closeWS(observerWs);
      await closeWS(defenderWs);
    }
  });
});

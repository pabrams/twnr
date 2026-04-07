import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestUser, createTestPlayer, connectWS, closeWS, wsRequest } from './helpers.mjs';
import { ensureServer, createPool } from './global-setup.mjs';
import { ClientMsgType, ServerMsgType } from '@twnr/shared';

const UNIVERSE_ID = 1;

let pool;

async function createPlayer(name, sector = 1, drones = 0, shields = 0) {
  const { userId, token } = await createTestUser(pool);
  const playerId = await createTestPlayer(pool, userId, UNIVERSE_ID, name, sector, drones, shields);
  return { id: playerId, token };
}

async function connectPlayer(token) {
  return connectWS({ token, universeId: UNIVERSE_ID });
}

before(async () => {
  await ensureServer();
  pool = createPool();
});

after(async () => {
  if (pool) await pool.end();
});

// ─── Combat resolution ──────────────────────────────────────────────────────

describe('Combat resolution', () => {
  it('shields absorb first at 1:1 (attacker drones consumed by shields)', async () => {
    const atk = await createPlayer('atk_sh1', 1, 10, 0);
    const def = await createPlayer('def_sh1', 1, 0, 5);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    try {
      const res = await wsRequest(ws1, { type: ClientMsgType.AttackShip, targetPlayerId: def.id, drones: 3 }, ServerMsgType.AttackShipResult);
      assert.equal(res.type, ServerMsgType.AttackShipResult);

      const atkShip = await pool.query('SELECT drones FROM player_ships WHERE player_id = $1', [atk.id]);
      assert.equal(atkShip.rows[0].drones, 7, 'Attacker should have 7 drones remaining');
      const defShip = await pool.query('SELECT shields, drones FROM player_ships WHERE player_id = $1', [def.id]);
      assert.equal(defShip.rows[0].shields, 2, 'Defender should have 2 shields remaining');
      assert.equal(defShip.rows[0].drones, 0, 'Defender drones should be unchanged at 0');
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
    }
  });

  it('drones engage after shields at 1:1 (mutual destruction)', async () => {
    const atk = await createPlayer('atk_mix', 1, 10, 0);
    const def = await createPlayer('def_mix', 1, 3, 2);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    try {
      const res = await wsRequest(ws1, { type: ClientMsgType.AttackShip, targetPlayerId: def.id, drones: 4 }, ServerMsgType.AttackShipResult);
      assert.equal(res.type, ServerMsgType.AttackShipResult);

      const atkShip = await pool.query('SELECT drones FROM player_ships WHERE player_id = $1', [atk.id]);
      assert.equal(atkShip.rows[0].drones, 6, 'Attacker should have 6 drones remaining');
      const defShip = await pool.query('SELECT drones, shields FROM player_ships WHERE player_id = $1', [def.id]);
      assert.equal(defShip.rows[0].drones, 1, 'Defender should have 1 drone remaining');
      assert.equal(defShip.rows[0].shields, 0, 'Defender should have 0 shields remaining');
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
    }
  });

  it('exact tie: attacker runs out at same time as defender defenses', async () => {
    const atk = await createPlayer('atk_tie', 1, 10, 0);
    const def = await createPlayer('def_tie', 1, 2, 3);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    try {
      const res = await wsRequest(ws1, { type: ClientMsgType.AttackShip, targetPlayerId: def.id, drones: 5 }, ServerMsgType.AttackShipResult);
      assert.equal(res.type, ServerMsgType.AttackShipResult);

      const atkShip = await pool.query('SELECT drones FROM player_ships WHERE player_id = $1', [atk.id]);
      assert.equal(atkShip.rows[0].drones, 5, 'Attacker should have 5 drones remaining');
      const defShip = await pool.query('SELECT drones, shields FROM player_ships WHERE player_id = $1', [def.id]);
      assert.equal(defShip.rows.length, 1, 'Defender ship should still exist (exact tie, no remaining attackers)');
      assert.equal(defShip.rows[0].drones, 0, 'Defender should have 0 drones');
      assert.equal(defShip.rows[0].shields, 0, 'Defender should have 0 shields');
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
    }
  });
});

// ─── Ship destruction ───────────────────────────────────────────────────────

describe('Ship destruction', () => {
  it('destroys ship when attacker overwhelms all defenses', async () => {
    const atk = await createPlayer('atk_dest', 1, 10, 0);
    const def = await createPlayer('def_dest', 1, 1, 1);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    try {
      const res = await wsRequest(ws1, { type: ClientMsgType.AttackShip, targetPlayerId: def.id, drones: 5 }, ServerMsgType.AttackShipResult);
      assert.equal(res.type, ServerMsgType.AttackShipResult);

      const atkShip = await pool.query('SELECT drones FROM player_ships WHERE player_id = $1', [atk.id]);
      assert.equal(atkShip.rows[0].drones, 8, 'Attacker should have 8 drones remaining');

      const defShip = await pool.query('SELECT * FROM player_ships WHERE player_id = $1', [def.id]);
      assert.equal(defShip.rows.length, 0, 'Defender ship should be deleted');
      const defCargo = await pool.query('SELECT * FROM ship_cargo WHERE player_id = $1', [def.id]);
      assert.equal(defCargo.rows.length, 0, 'Defender cargo should be deleted');

      const defPlayer = await pool.query('SELECT ship_destroyed_date FROM players WHERE id = $1', [def.id]);
      assert.ok(defPlayer.rows[0].ship_destroyed_date, 'ship_destroyed_date should be set');
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
    }
  });

  it('destroys ship when defender has 0 shields and 0 drones', async () => {
    const atk = await createPlayer('atk_bare', 1, 5, 0);
    const def = await createPlayer('def_bare', 1, 0, 0);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    try {
      const res = await wsRequest(ws1, { type: ClientMsgType.AttackShip, targetPlayerId: def.id, drones: 1 }, ServerMsgType.AttackShipResult);
      assert.equal(res.type, ServerMsgType.AttackShipResult);

      const atkShip = await pool.query('SELECT drones FROM player_ships WHERE player_id = $1', [atk.id]);
      assert.equal(atkShip.rows[0].drones, 5, 'Attacker should still have 5 drones');

      const defShip = await pool.query('SELECT * FROM player_ships WHERE player_id = $1', [def.id]);
      assert.equal(defShip.rows.length, 0, 'Defender ship should be deleted');

      const defPlayer = await pool.query('SELECT ship_destroyed_date FROM players WHERE id = $1', [def.id]);
      assert.ok(defPlayer.rows[0].ship_destroyed_date, 'ship_destroyed_date should be set');
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
    }
  });
});

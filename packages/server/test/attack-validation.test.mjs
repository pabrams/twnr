import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestUser, createTestPlayer, connectWS, closeWS, wsRequest } from './helpers.mjs';
import { ensureServer, createPool } from './global-setup.mjs';
import { Commands, Events } from '@twnr/shared';

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

describe('Shared protocol', () => {
  it('defines the AttackShip command and its reply', () => {
    assert.equal(Commands.AttackShip.name, 'attackShip');
    assert.equal(Commands.AttackShip.reply.name, 'attackShipResult');
  });
});

describe('Schema', () => {
  it('players table should have ship_destroyed_date column', async () => {
    const res = await pool.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = 'players' AND column_name = 'ship_destroyed_date'`,
    );
    assert.equal(res.rows.length, 1, 'ship_destroyed_date column should exist');
    assert.ok(
      res.rows[0].data_type.includes('timestamp'),
      `Expected timestamp type, got ${res.rows[0].data_type}`,
    );
  });
});

describe('Attack validation', () => {
  it('rejects an attack with 0 drones at the schema', async () => {
    const atk = await createPlayer('atk_zero', 1, 5, 0);
    const def = await createPlayer('def_zero', 1, 5, 0);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    try {
      const res = await wsRequest(ws1, { type: Commands.AttackShip.name, targetPlayerId: def.id, drones: 0 }, Commands.AttackShip.reply.name);
      assert.equal(res.type, Events.ProtocolError.name);
      assert.equal(res.reason, 'rejected');
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
    }
  });

  it('rejects an attack with negative drones at the schema', async () => {
    const atk = await createPlayer('atk_neg', 1, 5, 0);
    const def = await createPlayer('def_neg', 1, 5, 0);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    try {
      const res = await wsRequest(ws1, { type: Commands.AttackShip.name, targetPlayerId: def.id, drones: -1 }, Commands.AttackShip.reply.name);
      assert.equal(res.type, Events.ProtocolError.name);
      assert.equal(res.reason, 'rejected');
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
    }
  });

  it('refuses an attack when the attacker lacks enough drones', async () => {
    const atk = await createPlayer('atk_few', 1, 3, 0);
    const def = await createPlayer('def_few', 1, 5, 0);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    try {
      const res = await wsRequest(ws1, { type: Commands.AttackShip.name, targetPlayerId: def.id, drones: 5 }, Commands.AttackShip.reply.name);
      assert.equal(res.outcome, 'refused');
      assert.equal(res.reason, 'notEnoughDrones');
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
    }
  });

  it('refuses an attack when the players are in different sectors', async () => {
    const atk = await createPlayer('atk_diff', 1, 5, 0);
    const def = await createPlayer('def_diff', 2, 5, 0);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    try {
      const res = await wsRequest(ws1, { type: Commands.AttackShip.name, targetPlayerId: def.id, drones: 1 }, Commands.AttackShip.reply.name);
      assert.equal(res.outcome, 'refused');
      assert.equal(res.reason, 'targetNotHere');
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
    }
  });
});

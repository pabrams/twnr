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

// ─── Shared types ───────────────────────────────────────────────────────────

describe('Shared types', () => {
  it('ClientMsgType should include AttackShip', async () => {
    const shared = await import('@twnr/shared');
    assert.ok(shared.ClientMsgType.AttackShip, 'ClientMsgType.AttackShip should be defined');
    assert.equal(typeof shared.ClientMsgType.AttackShip, 'string');
  });

  it('ServerMsgType should include AttackShipResult', async () => {
    const shared = await import('@twnr/shared');
    assert.ok(shared.ServerMsgType.AttackShipResult, 'ServerMsgType.AttackShipResult should be defined');
    assert.equal(typeof shared.ServerMsgType.AttackShipResult, 'string');
  });
});

// ─── Schema ─────────────────────────────────────────────────────────────────

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

// ─── Attack validation ──────────────────────────────────────────────────────

describe('Attack validation', () => {
  it('should reject attack on self', async () => {
    const p = await createPlayer('self_atk', 1, 5, 0);
    const { ws } = await connectPlayer(p.token);
    try {
      const res = await wsRequest(ws, { type: ClientMsgType.AttackShip, targetPlayerId: p.id, drones: 1 }, ServerMsgType.AttackShipResult);
      assert.equal(res.type, ServerMsgType.Error, 'Should return error for self-attack');
    } finally {
      await closeWS(ws);
    }
  });

  it('should reject attack with 0 drones', async () => {
    const atk = await createPlayer('atk_zero', 1, 5, 0);
    const def = await createPlayer('def_zero', 1, 5, 0);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    try {
      const res = await wsRequest(ws1, { type: ClientMsgType.AttackShip, targetPlayerId: def.id, drones: 0 }, ServerMsgType.AttackShipResult);
      assert.equal(res.type, ServerMsgType.Error);
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
    }
  });

  it('should reject attack with negative drones', async () => {
    const atk = await createPlayer('atk_neg', 1, 5, 0);
    const def = await createPlayer('def_neg', 1, 5, 0);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    try {
      const res = await wsRequest(ws1, { type: ClientMsgType.AttackShip, targetPlayerId: def.id, drones: -1 }, ServerMsgType.AttackShipResult);
      assert.equal(res.type, ServerMsgType.Error);
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
    }
  });

  it('should reject attack when attacker lacks enough drones', async () => {
    const atk = await createPlayer('atk_few', 1, 3, 0);
    const def = await createPlayer('def_few', 1, 5, 0);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    try {
      const res = await wsRequest(ws1, { type: ClientMsgType.AttackShip, targetPlayerId: def.id, drones: 5 }, ServerMsgType.AttackShipResult);
      assert.equal(res.type, ServerMsgType.Error);
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
    }
  });

  it('should reject attack when players are in different sectors', async () => {
    const atk = await createPlayer('atk_diff', 1, 5, 0);
    const def = await createPlayer('def_diff', 2, 5, 0);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    try {
      const res = await wsRequest(ws1, { type: ClientMsgType.AttackShip, targetPlayerId: def.id, drones: 1 }, ServerMsgType.AttackShipResult);
      assert.equal(res.type, ServerMsgType.Error);
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
    }
  });
});

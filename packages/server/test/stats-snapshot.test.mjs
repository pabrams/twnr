import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestUser, createTestPlayer, connectWS, closeWS, waitForMsg, wsRequest } from './helpers.mjs';
import { ensureServer, createPool } from './global-setup.mjs';
import { Commands, Events } from '@twnr/shared';

const UNIVERSE_ID = 1;

let pool;

before(async () => {
  await ensureServer();
  pool = createPool();
});

after(async () => {
  if (pool) await pool.end();
});

describe('Stats snapshot', () => {
  it('includes the trader name', async () => {
    const traderName = `snap_${Date.now()}`;
    const { userId, token } = await createTestUser(pool);
    await createTestPlayer(pool, userId, UNIVERSE_ID, traderName, 1);
    const { ws, ready } = await connectWS({ token, universeId: UNIVERSE_ID });
    await ready;
    try {
      const snapshot = waitForMsg(ws, Events.StatsSnapshot.name);
      await wsRequest(ws, { type: Commands.ShipInfo.name }, Commands.ShipInfo.reply.name);
      assert.equal((await snapshot).traderName, traderName);
    } finally {
      await closeWS(ws);
    }
  });
});

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestUser, createTestPlayer, connectWS, closeWS, wsRequest } from './helpers.mjs';
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

async function waitForLoggedCommand(playerId, commandType) {
  for (let i = 0; i < 20; i++) {
    const res = await pool.query(
      `SELECT payload, outcome FROM command_log
       WHERE player_id = $1 AND command_type = $2 ORDER BY id DESC LIMIT 1`,
      [playerId, commandType],
    );
    if (res.rows.length > 0) return res.rows[0];
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`command ${commandType} was never logged`);
}

describe('command_log outcomes', () => {
  it('records the reply outcome, plus refused / rejected for refusals and bad requests', async () => {
    const { userId, token } = await createTestUser(pool);
    const playerId = await createTestPlayer(pool, userId, UNIVERSE_ID, `cl_${Date.now()}`, 1);
    const { ws, ready } = await connectWS({ token, universeId: UNIVERSE_ID });
    await ready;
    try {
      const moved = await wsRequest(ws, { type: Commands.Move.name, sector: 99 }, Commands.Move.reply.name);
      assert.equal(moved.outcome, 'nonAdjacent');
      assert.equal((await waitForLoggedCommand(playerId, Commands.Move.name)).outcome, 'nonAdjacent');

      await wsRequest(ws, { type: Commands.SectorDisplay.name }, Commands.SectorDisplay.reply.name);
      assert.equal((await waitForLoggedCommand(playerId, Commands.SectorDisplay.name)).outcome, 'ok');

      const refused = await wsRequest(ws, { type: Commands.ClanLeave.name }, Commands.ClanLeave.reply.name);
      assert.equal(refused.outcome, 'refused');
      assert.equal((await waitForLoggedCommand(playerId, Commands.ClanLeave.name)).outcome, 'refused');

      // A one-letter clan name fails the schema: the client's fault, logged as rejected with the password redacted.
      const rejected = await wsRequest(ws, { type: Commands.ClanCreate.name, name: 'x', password: 'hunter22' }, Commands.ClanCreate.reply.name);
      assert.equal(rejected.type, Events.ProtocolError.name);
      assert.equal(rejected.reason, 'rejected');
      const logged = await waitForLoggedCommand(playerId, Commands.ClanCreate.name);
      assert.equal(logged.outcome, 'rejected');
      assert.equal(logged.payload.password, '[redacted]');
      assert.equal(logged.payload.name, 'x');

      // 0 is not an amount to move: -1 means all, anything else must be positive.
      const zero = await wsRequest(ws, { type: Commands.TakeColonists.name, quantity: 0, commodity: 'fuel' }, Commands.TakeColonists.reply.name);
      assert.equal(zero.type, Events.ProtocolError.name);
      assert.equal((await waitForLoggedCommand(playerId, Commands.TakeColonists.name)).outcome, 'rejected');

      ws.send(JSON.stringify({ type: Commands.DeleteAllMail.name }));
      assert.equal((await waitForLoggedCommand(playerId, Commands.DeleteAllMail.name)).outcome, 'ok');
    } finally {
      await closeWS(ws);
    }
  });
});

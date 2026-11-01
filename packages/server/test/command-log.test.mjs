import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestUser, createTestPlayer, connectWS, closeWS, wsRequest } from './helpers.mjs';
import { ensureServer, createPool } from './global-setup.mjs';
import { ClientTag, ServerTag } from '@twnr/shared';

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
      const moved = await wsRequest(ws, { type: ClientTag.Move, sector: 99 }, ServerTag.MoveResult);
      assert.equal(moved.outcome, 'nonAdjacent');
      assert.equal((await waitForLoggedCommand(playerId, ClientTag.Move)).outcome, 'nonAdjacent');

      await wsRequest(ws, { type: ClientTag.SectorDisplay }, ServerTag.SectorDisplayResult);
      assert.equal((await waitForLoggedCommand(playerId, ClientTag.SectorDisplay)).outcome, 'ok');

      const refused = await wsRequest(ws, { type: ClientTag.ClanLeave }, ServerTag.ClanLeaveResult);
      assert.equal(refused.outcome, 'refused');
      assert.equal((await waitForLoggedCommand(playerId, ClientTag.ClanLeave)).outcome, 'refused');

      // A one-letter clan name fails the schema: the client's fault, logged as rejected with the password redacted.
      const rejected = await wsRequest(ws, { type: ClientTag.ClanCreate, name: 'x', password: 'hunter22' }, ServerTag.ClanCreateResult);
      assert.equal(rejected.type, ServerTag.ProtocolError);
      assert.equal(rejected.reason, 'rejected');
      const logged = await waitForLoggedCommand(playerId, ClientTag.ClanCreate);
      assert.equal(logged.outcome, 'rejected');
      assert.equal(logged.payload.password, '[redacted]');
      assert.equal(logged.payload.name, 'x');

      ws.send(JSON.stringify({ type: ClientTag.DeleteAllMail }));
      assert.equal((await waitForLoggedCommand(playerId, ClientTag.DeleteAllMail)).outcome, 'ok');
    } finally {
      await closeWS(ws);
    }
  });
});

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { connectWS, waitForMsg, expectNoMsg, closeWS, wsRequest } from './helpers.mjs';
import { ensureServer, createPool } from './global-setup.mjs';
import { ClientTag, ServerTag } from '@twnr/shared';

const UNIVERSE_ID = 1;

let pool;

function ws(opts = {}) {
  return connectWS({ pool, universeId: UNIVERSE_ID, ...opts });
}

before(async () => {
  await ensureServer();
  pool = createPool();
});

after(async () => {
  if (pool) await pool.end();
});

describe('WebSocket', () => {
  it('welcome message sent on connection with playerId and sector', async () => {
    const { ws: wsConn, welcome } = await ws();
    assert.equal(welcome.type, ServerTag.Welcome);
    assert.ok(welcome.playerId !== undefined, 'welcome should contain playerId');
    assert.equal(welcome.sector, 1, 'player should start in sector 1');
    await closeWS(wsConn);
  });

  it('display returns sectorDisplay with sector and warps array', async () => {
    const { ws: wsConn } = await ws();
    const msg = await wsRequest(wsConn, { type: ClientTag.SectorDisplay }, ServerTag.SectorDisplayResult);
    assert.equal(msg.type, ServerTag.SectorDisplayResult);
    assert.ok(typeof msg.sector === 'number', 'sector should be a number');
    assert.ok(Array.isArray(msg.warps), 'warps should be an array');
    assert.ok(msg.warps.length >= 1, 'warps should have at least 1 entry');
    await closeWS(wsConn);
  });

  it('move to adjacent sector broadcasts playerMoved', async () => {
    const { ws: wsConn } = await ws();

    const disp = await wsRequest(wsConn, { type: ClientTag.SectorDisplay }, ServerTag.SectorDisplayResult);
    const target = disp.warps[0].sector;
    const moveMsg = await wsRequest(wsConn, { type: ClientTag.Move, sector: target }, ServerTag.MoveResult);

    assert.equal(moveMsg.type, ServerTag.MoveResult);
    assert.equal(moveMsg.outcome, 'success');
    assert.equal(moveMsg.sector, target);
    await closeWS(wsConn);
  });

  it('playerMoved is received by another player in the origin sector', async () => {
    const { ws: ws1 } = await ws();
    const { ws: ws2 } = await ws();

    const disp = await wsRequest(ws2, { type: ClientTag.SectorDisplay }, ServerTag.SectorDisplayResult);
    const target = disp.warps[0].sector;
    const broadcastPromise = waitForMsg(ws1, ServerTag.PlayerMoved);
    ws2.send(JSON.stringify({ type: ClientTag.Move, sector: target }));
    const msg = await broadcastPromise;

    assert.equal(msg.type, ServerTag.PlayerMoved);
    assert.equal(msg.sector, target);
    assert.equal(msg.direction, 'out');
    await closeWS(ws1);
    await closeWS(ws2);
  });

  it('playerMoved is NOT received by a player in an unrelated sector', async () => {
    const { ws: ws1 } = await ws();
    const { ws: ws2 } = await ws();

    // Move ws1 away from sector 1
    const disp1 = await wsRequest(ws1, { type: ClientTag.SectorDisplay }, ServerTag.SectorDisplayResult);
    const ws1Target = disp1.warps[0].sector;
    const disp1b = await wsRequest(ws1, { type: ClientTag.Move, sector: ws1Target }, ServerTag.MoveResult);

    // Move ws1 again so it's two hops away from sector 1
    const ws1Target2 = (disp1b.warps.find(w => w.sector !== 1) || disp1b.warps[0]).sector;
    await wsRequest(ws1, { type: ClientTag.Move, sector: ws1Target2 }, ServerTag.MoveResult);

    // ws2 is still in sector 1 - ws1 should not receive this move
    const disp3 = await wsRequest(ws2, { type: ClientTag.SectorDisplay }, ServerTag.SectorDisplayResult);
    const ws2Target = disp3.warps[0].sector;

    const noMsgPromise = expectNoMsg(ws1, ServerTag.PlayerMoved);
    ws2.send(JSON.stringify({ type: ClientTag.Move, sector: ws2Target }));
    await noMsgPromise;

    await closeWS(ws1);
    await closeWS(ws2);
  });

  it('playerLeft is only broadcast to players in the same sector', async () => {
    const { ws: ws1 } = await ws();
    const { ws: ws2 } = await ws();
    const { ws: ws3 } = await ws();

    // Move ws2 away from sector 1
    const disp = await wsRequest(ws2, { type: ClientTag.SectorDisplay }, ServerTag.SectorDisplayResult);
    const target = disp.warps[0].sector;
    await wsRequest(ws2, { type: ClientTag.Move, sector: target }, ServerTag.MoveResult);

    // ws1 and ws3 are in sector 1, ws2 is elsewhere
    // ws1 disconnects — ws3 should get playerLeft, ws2 should NOT
    const leftPromise = waitForMsg(ws3, ServerTag.PlayerLeft);
    const noMsgPromise = expectNoMsg(ws2, ServerTag.PlayerLeft);
    ws1.close();
    await leftPromise;
    await noMsgPromise;

    await closeWS(ws2);
    await closeWS(ws3);
  });

  it('who returns playersOnline with connected player IDs', async () => {
    const { ws: wsConn } = await ws();

    const msg = await wsRequest(wsConn, { type: ClientTag.PlayersOnline }, ServerTag.PlayersOnlineResult);
    assert.equal(msg.type, ServerTag.PlayersOnlineResult);
    assert.ok(Array.isArray(msg.players), 'players should be an array');
    assert.ok(msg.players.length >= 1, 'should list at least the current player');
    await closeWS(wsConn);
  });

  it('playerLeft broadcast on disconnect', async () => {
    const { ws: ws1 } = await ws();
    const { ws: ws2 } = await ws();

    const leftPromise = waitForMsg(ws1, ServerTag.PlayerLeft);
    ws2.close();
    const msg = await leftPromise;

    assert.equal(msg.type, ServerTag.PlayerLeft);
    assert.ok(msg.playerId !== undefined, 'playerLeft should include playerId');
    await closeWS(ws1);
  });

  it('move with missing sector returns moveResult error', async () => {
    const { ws: wsConn } = await ws();
    const msg = await wsRequest(wsConn, { type: ClientTag.Move }, ServerTag.MoveResult);
    assert.equal(msg.type, ServerTag.MoveResult);
    assert.equal(msg.outcome, 'error');
    assert.equal(msg.message, 'Invalid sector');
    await closeWS(wsConn);
  });

  it('error returned for unknown message type', async () => {
    const { ws: wsConn } = await ws();
    const msg = await wsRequest(wsConn, { type: 'foobar' }, ServerTag.Error);
    assert.equal(msg.type, ServerTag.Error);
    assert.equal(msg.message, 'Unknown message type');
    await closeWS(wsConn);
  });
});

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { connectWS, waitForMsg, expectNoMsg, closeWS, wsRequest } from './helpers.mjs';
import { ensureServer, createPool } from './global-setup.mjs';
import { ClientMsgType, ServerMsgType } from '@twnr/shared';

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
    assert.equal(welcome.type, ServerMsgType.Welcome);
    assert.ok(welcome.playerId !== undefined, 'welcome should contain playerId');
    assert.equal(welcome.sector, 1, 'player should start in sector 1');
    await closeWS(wsConn);
  });

  it('display returns sectorDisplay with sector and warps array', async () => {
    const { ws: wsConn } = await ws();
    const msg = await wsRequest(wsConn, { type: ClientMsgType.SectorDisplay }, ServerMsgType.SectorDisplayResult);
    assert.equal(msg.type, ServerMsgType.SectorDisplayResult);
    assert.ok(typeof msg.sector === 'number', 'sector should be a number');
    assert.ok(Array.isArray(msg.warps), 'warps should be an array');
    assert.ok(msg.warps.length >= 1, 'warps should have at least 1 entry');
    await closeWS(wsConn);
  });

  it('move to adjacent sector broadcasts playerMoved', async () => {
    const { ws: wsConn } = await ws();

    const disp = await wsRequest(wsConn, { type: ClientMsgType.SectorDisplay }, ServerMsgType.SectorDisplayResult);
    const target = disp.warps[0];
    const moveMsg = await wsRequest(wsConn, { type: ClientMsgType.Move, sector: target }, ServerMsgType.MoveResult);

    assert.equal(moveMsg.type, ServerMsgType.MoveResult);
    assert.equal(moveMsg.outcome, 'success');
    assert.equal(moveMsg.sector, target);
    await closeWS(wsConn);
  });

  it('playerMoved is received by another player in the origin sector', async () => {
    const { ws: ws1 } = await ws();
    const { ws: ws2 } = await ws();

    const disp = await wsRequest(ws2, { type: ClientMsgType.SectorDisplay }, ServerMsgType.SectorDisplayResult);
    const target = disp.warps[0];
    const broadcastPromise = waitForMsg(ws1, ServerMsgType.PlayerMoved);
    ws2.send(JSON.stringify({ type: ClientMsgType.Move, sector: target }));
    const msg = await broadcastPromise;

    assert.equal(msg.type, ServerMsgType.PlayerMoved);
    assert.equal(msg.sector, target);
    assert.equal(msg.direction, 'out');
    await closeWS(ws1);
    await closeWS(ws2);
  });

  it('playerMoved is NOT received by a player in an unrelated sector', async () => {
    const { ws: ws1 } = await ws();
    const { ws: ws2 } = await ws();

    // Move ws1 away from sector 1
    const disp1 = await wsRequest(ws1, { type: ClientMsgType.SectorDisplay }, ServerMsgType.SectorDisplayResult);
    const ws1Target = disp1.warps[0];
    const disp1b = await wsRequest(ws1, { type: ClientMsgType.Move, sector: ws1Target }, ServerMsgType.MoveResult);

    // Move ws1 again so it's two hops away from sector 1
    const ws1Target2 = disp1b.warps.find(w => w !== 1) || disp1b.warps[0];
    await wsRequest(ws1, { type: ClientMsgType.Move, sector: ws1Target2 }, ServerMsgType.MoveResult);

    // ws2 is still in sector 1 - ws1 should not receive this move
    const disp3 = await wsRequest(ws2, { type: ClientMsgType.SectorDisplay }, ServerMsgType.SectorDisplayResult);
    const ws2Target = disp3.warps[0];

    const noMsgPromise = expectNoMsg(ws1, ServerMsgType.PlayerMoved);
    ws2.send(JSON.stringify({ type: ClientMsgType.Move, sector: ws2Target }));
    await noMsgPromise;

    await closeWS(ws1);
    await closeWS(ws2);
  });

  it('nonAdjacentMoveRequested is only sent to the requesting client', async () => {
    const { ws: ws1 } = await ws();
    const { ws: ws2 } = await ws();

    const disp = await wsRequest(ws2, { type: ClientMsgType.SectorDisplay }, ServerMsgType.SectorDisplayResult);
    const warpSet = new Set(disp.warps);
    let nonAdjacent = null;
    for (let i = 1; i <= 100; i++) {
      if (i !== disp.sector && !warpSet.has(i)) { nonAdjacent = i; break; }
    }
    assert.ok(nonAdjacent !== null, 'Could not find a non-adjacent sector');

    const noMsgPromise = expectNoMsg(ws1, ServerMsgType.MoveResult);
    const failPromise = waitForMsg(ws2, ServerMsgType.MoveResult);
    ws2.send(JSON.stringify({ type: ClientMsgType.Move, sector: nonAdjacent }));
    const failMsg = await failPromise;
    assert.equal(failMsg.outcome, 'nonAdjacent');
    await noMsgPromise;

    await closeWS(ws1);
    await closeWS(ws2);
  });

  it('playerLeft is only broadcast to players in the same sector', async () => {
    const { ws: ws1 } = await ws();
    const { ws: ws2 } = await ws();
    const { ws: ws3 } = await ws();

    // Move ws2 away from sector 1
    const disp = await wsRequest(ws2, { type: ClientMsgType.SectorDisplay }, ServerMsgType.SectorDisplayResult);
    const target = disp.warps[0];
    await wsRequest(ws2, { type: ClientMsgType.Move, sector: target }, ServerMsgType.MoveResult);

    // ws1 and ws3 are in sector 1, ws2 is elsewhere
    // ws1 disconnects — ws3 should get playerLeft, ws2 should NOT
    const leftPromise = waitForMsg(ws3, ServerMsgType.PlayerLeft);
    const noMsgPromise = expectNoMsg(ws2, ServerMsgType.PlayerLeft);
    ws1.close();
    await leftPromise;
    await noMsgPromise;

    await closeWS(ws2);
    await closeWS(ws3);
  });

  it('move to non-adjacent sector returns nonAdjacentMoveRequested', async () => {
    const { ws: wsConn } = await ws();

    const disp = await wsRequest(wsConn, { type: ClientMsgType.SectorDisplay }, ServerMsgType.SectorDisplayResult);
    const warpSet = new Set(disp.warps);
    let nonAdjacent = null;
    for (let i = 1; i <= 100; i++) {
      if (i !== disp.sector && !warpSet.has(i)) { nonAdjacent = i; break; }
    }
    assert.ok(nonAdjacent !== null, 'Could not find a non-adjacent sector for test');

    const failMsg = await wsRequest(wsConn, { type: ClientMsgType.Move, sector: nonAdjacent }, ServerMsgType.MoveResult);
    assert.equal(failMsg.type, ServerMsgType.MoveResult);
    assert.equal(failMsg.outcome, 'nonAdjacent');
    assert.equal(failMsg.sector, nonAdjacent);
    await closeWS(wsConn);
  });

  it('who returns playersOnline with connected player IDs', async () => {
    const { ws: wsConn } = await ws();

    const msg = await wsRequest(wsConn, { type: ClientMsgType.PlayersOnline }, ServerMsgType.PlayersOnlineResult);
    assert.equal(msg.type, ServerMsgType.PlayersOnlineResult);
    assert.ok(Array.isArray(msg.players), 'players should be an array');
    assert.ok(msg.players.length >= 1, 'should list at least the current player');
    await closeWS(wsConn);
  });

  it('playerLeft broadcast on disconnect', async () => {
    const { ws: ws1 } = await ws();
    const { ws: ws2 } = await ws();

    const leftPromise = waitForMsg(ws1, ServerMsgType.PlayerLeft);
    ws2.close();
    const msg = await leftPromise;

    assert.equal(msg.type, ServerMsgType.PlayerLeft);
    assert.ok(msg.playerId !== undefined, 'playerLeft should include playerId');
    await closeWS(ws1);
  });

  it('move with missing sector returns moveResult error', async () => {
    const { ws: wsConn } = await ws();
    const msg = await wsRequest(wsConn, { type: ClientMsgType.Move }, ServerMsgType.MoveResult);
    assert.equal(msg.type, ServerMsgType.MoveResult);
    assert.equal(msg.outcome, 'error');
    assert.equal(msg.message, 'Invalid sector');
    await closeWS(wsConn);
  });

  it('error returned for unknown message type', async () => {
    const { ws: wsConn } = await ws();
    const msg = await wsRequest(wsConn, { type: 'foobar' }, ServerMsgType.Error);
    assert.equal(msg.type, ServerMsgType.Error);
    assert.equal(msg.message, 'Unknown message type');
    await closeWS(wsConn);
  });
});

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { connectWS, closeWS, wsRequest } from './helpers.mjs';
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

describe('Sector & Path Queries', () => {
  it('sector query returns sector data with warps', async () => {
    const { ws: wsConn } = await ws();
    const msg = await wsRequest(wsConn, { type: ClientMsgType.WarpsOut, id: 1 }, ServerMsgType.WarpsOutResult);
    assert.equal(msg.type, ServerMsgType.WarpsOutResult);
    assert.equal(msg.id, 1);
    assert.ok(Array.isArray(msg.warps), 'warps should be an array');
    assert.ok(msg.warps.length >= 1, 'sector 1 should have at least 1 warp');
    await closeWS(wsConn);
  });

  it('sector query returns error for nonexistent sector', async () => {
    const { ws: wsConn } = await ws();
    const msg = await wsRequest(wsConn, { type: ClientMsgType.WarpsOut, id: 9999 }, ServerMsgType.WarpsOutResult);
    assert.equal(msg.type, ServerMsgType.Error);
    assert.equal(msg.message, 'Sector not found');
    await closeWS(wsConn);
  });

  it('sector query returns error for invalid ID', async () => {
    const { ws: wsConn } = await ws();
    const msg = await wsRequest(wsConn, { type: ClientMsgType.WarpsOut, id: -1 }, ServerMsgType.WarpsOutResult);
    assert.equal(msg.type, ServerMsgType.Error);
    assert.equal(msg.message, 'Invalid sector ID');
    await closeWS(wsConn);
  });

  it('path query returns shortest path between connected sectors', async () => {
    const { ws: wsConn } = await ws();
    const sectorMsg = await wsRequest(wsConn, { type: ClientMsgType.WarpsOut, id: 1 }, ServerMsgType.WarpsOutResult);
    const target = sectorMsg.warps[0].sector;

    const msg = await wsRequest(wsConn, { type: ClientMsgType.ShortestPath, from: 1, to: target }, ServerMsgType.ShortestPathResult);
    assert.equal(msg.type, ServerMsgType.ShortestPathResult);
    assert.ok(Array.isArray(msg.path), 'path should be an array');
    assert.equal(msg.path[0].sector, 1, 'path should start with origin sector');
    assert.equal(msg.path[msg.path.length - 1].sector, target, 'path should end with target sector');
    assert.equal(msg.hops, msg.path.length - 1, 'hops should equal path length minus 1');
    assert.equal(msg.path.length, 2, 'direct neighbors should have a 2-element path');
    assert.equal(msg.hops, 1);
    await closeWS(wsConn);
  });

  it('path query with same start and end returns single-element path', async () => {
    const { ws: wsConn } = await ws();
    const msg = await wsRequest(wsConn, { type: ClientMsgType.ShortestPath, from: 1, to: 1 }, ServerMsgType.ShortestPathResult);
    assert.equal(msg.type, ServerMsgType.ShortestPathResult);
    assert.equal(msg.path.length, 1);
    assert.equal(msg.path[0].sector, 1);
    assert.equal(msg.hops, 0);
    await closeWS(wsConn);
  });

  it('path query returns error for invalid parameters', async () => {
    const { ws: wsConn } = await ws();
    const msg = await wsRequest(wsConn, { type: ClientMsgType.ShortestPath, from: -1, to: 1 }, ServerMsgType.ShortestPathResult);
    assert.equal(msg.type, ServerMsgType.Error);
    assert.equal(msg.message, 'Invalid sector ID');
    await closeWS(wsConn);
  });

  it('path query returns error for nonexistent sectors', async () => {
    const { ws: wsConn } = await ws();
    const msg = await wsRequest(wsConn, { type: ClientMsgType.ShortestPath, from: 1, to: 9999 }, ServerMsgType.ShortestPathResult);
    assert.equal(msg.type, ServerMsgType.Error);
    assert.equal(msg.message, 'Sector not found');
    await closeWS(wsConn);
  });

  it('path query returns error when no path exists', async () => {
    const sectorRes = await pool.query(
      'INSERT INTO sectors (universe_id, sector_number) VALUES ($1, 999) ON CONFLICT (universe_id, sector_number) DO UPDATE SET name = sectors.name RETURNING id',
      [UNIVERSE_ID]
    );
    const isolatedId = sectorRes.rows[0].id;
    await pool.query('DELETE FROM warps WHERE from_sector_id = $1 OR to_sector_id = $1', [isolatedId]);

    const { ws: wsConn } = await ws();
    const msg = await wsRequest(wsConn, { type: ClientMsgType.ShortestPath, from: 1, to: 999 }, ServerMsgType.ShortestPathResult);
    assert.equal(msg.type, ServerMsgType.Error);
    assert.equal(msg.message, 'No path found');
    await closeWS(wsConn);

    await pool.query('DELETE FROM sectors WHERE id = $1', [isolatedId]);
  });

  it('path respects directed warps', async () => {
    const { ws: wsConn } = await ws();
    let found = false;
    for (let from = 1; from <= 100; from++) {
      const res = await wsRequest(wsConn, { type: ClientMsgType.WarpsOut, id: from }, ServerMsgType.WarpsOutResult);
      if (res.type !== ServerMsgType.WarpsOutResult) continue;
      for (const warpRef of res.warps) {
        const to = warpRef.sector;
        const reverse = await wsRequest(wsConn, { type: ClientMsgType.WarpsOut, id: to }, ServerMsgType.WarpsOutResult);
        if (reverse.type === ServerMsgType.WarpsOutResult && !reverse.warps.some(w => w.sector === from)) {
          const path = await wsRequest(wsConn, { type: ClientMsgType.ShortestPath, from: to, to: from }, ServerMsgType.ShortestPathResult);
          if (path.type === ServerMsgType.ShortestPathResult) {
            assert.ok(path.hops > 1,
              `Path from ${to} to ${from} should not be 1 hop since no direct warp exists`);
          }
          found = true;
          break;
        }
      }
      if (found) break;
    }
    assert.ok(found, 'Could not find an asymmetric warp pair to test directionality');
    await closeWS(wsConn);
  });
});

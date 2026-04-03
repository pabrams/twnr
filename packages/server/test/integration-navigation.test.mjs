import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  createPool,
  startServer,
  connectWS,
  closeWS,
  wsRequest,
  testEnv,
} from './helpers.mjs';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = join(dirname(__filename), '..');
const UNIVERSE_ID = 1;

let pool;
let serverProc;

function ws(opts = {}) {
  return connectWS({ pool, universeId: UNIVERSE_ID, ...opts });
}

before(async () => {
  const universeDir = mkdtempSync(join(tmpdir(), 'twnr_test_universe_'));
  try {
    rmSync(universeDir, { recursive: true, force: true });
    const gen = spawnSync(process.execPath, [
      join(PROJECT_ROOT, 'scripts', 'twnr-bigbang.js'),
      universeDir, '--sectors', '100', '--seed', '42',
    ], { encoding: 'utf8', cwd: PROJECT_ROOT });
    if (gen.status !== 0) throw new Error(`bigbang failed: ${gen.stderr}`);

    pool = createPool();
    await pool.query('SELECT 1');
    await pool.query('DROP TABLE IF EXISTS ship_cargo, player_ships, ports, warps, players, sectors, universes, users CASCADE');
    await pool.end();

    const imp = spawnSync(process.execPath, [
      join(PROJECT_ROOT, 'scripts', 'importUniverse.js'),
      universeDir, '--force',
    ], { encoding: 'utf8', cwd: PROJECT_ROOT, env: testEnv() });
    if (imp.status !== 0) throw new Error(`importUniverse failed: ${imp.stderr}`);

    serverProc = await startServer();
  } finally {
    rmSync(universeDir, { recursive: true, force: true });
  }

  pool = createPool();
});

after(async () => {
  if (serverProc) serverProc.kill();
  if (pool) await pool.end();
});

describe('Sector & Path Queries', () => {
  it('sector query returns sector data with warps', async () => {
    const { ws: wsConn } = await ws();
    const msg = await wsRequest(wsConn, { type: 'sector', id: 1 }, 'sectorWarps');
    assert.equal(msg.type, 'sectorWarps');
    assert.equal(msg.id, 1);
    assert.ok(Array.isArray(msg.warps), 'warps should be an array');
    assert.ok(msg.warps.length >= 1, 'sector 1 should have at least 1 warp');
    await closeWS(wsConn);
  });

  it('sector query returns error for nonexistent sector', async () => {
    const { ws: wsConn } = await ws();
    const msg = await wsRequest(wsConn, { type: 'sector', id: 9999 }, 'sectorWarps');
    assert.equal(msg.type, 'error');
    assert.equal(msg.message, 'Sector not found');
    await closeWS(wsConn);
  });

  it('sector query returns error for invalid ID', async () => {
    const { ws: wsConn } = await ws();
    const msg = await wsRequest(wsConn, { type: 'sector', id: -1 }, 'sectorWarps');
    assert.equal(msg.type, 'error');
    assert.equal(msg.message, 'Invalid sector ID');
    await closeWS(wsConn);
  });

  it('path query returns shortest path between connected sectors', async () => {
    const { ws: wsConn } = await ws();
    const sectorMsg = await wsRequest(wsConn, { type: 'sector', id: 1 }, 'sectorWarps');
    const target = sectorMsg.warps[0];

    const msg = await wsRequest(wsConn, { type: 'path', from: 1, to: target }, 'pathResult');
    assert.equal(msg.type, 'pathResult');
    assert.ok(Array.isArray(msg.path), 'path should be an array');
    assert.equal(msg.path[0], 1, 'path should start with origin sector');
    assert.equal(msg.path[msg.path.length - 1], target, 'path should end with target sector');
    assert.equal(msg.hops, msg.path.length - 1, 'hops should equal path length minus 1');
    assert.equal(msg.path.length, 2, 'direct neighbors should have a 2-element path');
    assert.equal(msg.hops, 1);
    await closeWS(wsConn);
  });

  it('path query with same start and end returns single-element path', async () => {
    const { ws: wsConn } = await ws();
    const msg = await wsRequest(wsConn, { type: 'path', from: 1, to: 1 }, 'pathResult');
    assert.equal(msg.type, 'pathResult');
    assert.deepStrictEqual(msg.path, [1]);
    assert.equal(msg.hops, 0);
    await closeWS(wsConn);
  });

  it('path query returns error for invalid parameters', async () => {
    const { ws: wsConn } = await ws();
    const msg = await wsRequest(wsConn, { type: 'path', from: -1, to: 1 }, 'pathResult');
    assert.equal(msg.type, 'error');
    assert.equal(msg.message, 'Invalid sector ID');
    await closeWS(wsConn);
  });

  it('path query returns error for nonexistent sectors', async () => {
    const { ws: wsConn } = await ws();
    const msg = await wsRequest(wsConn, { type: 'path', from: 1, to: 9999 }, 'pathResult');
    assert.equal(msg.type, 'error');
    assert.equal(msg.message, 'Sector not found');
    await closeWS(wsConn);
  });

  it('path query returns error when no path exists', async () => {
    await pool.query('INSERT INTO sectors (id, universe_id) VALUES (999, $1) ON CONFLICT DO NOTHING', [UNIVERSE_ID]);
    await pool.query('DELETE FROM warps WHERE (sector_from = 999 OR sector_to = 999) AND universe_id = $1', [UNIVERSE_ID]);

    const { ws: wsConn } = await ws();
    const msg = await wsRequest(wsConn, { type: 'path', from: 1, to: 999 }, 'pathResult');
    assert.equal(msg.type, 'error');
    assert.equal(msg.message, 'No path found');
    await closeWS(wsConn);

    await pool.query('DELETE FROM sectors WHERE id = 999 AND universe_id = $1', [UNIVERSE_ID]);
  });

  it('path respects directed warps', async () => {
    const { ws: wsConn } = await ws();
    let found = false;
    for (let from = 1; from <= 100; from++) {
      const res = await wsRequest(wsConn, { type: 'sector', id: from }, 'sectorWarps');
      if (res.type !== 'sectorWarps') continue;
      for (const to of res.warps) {
        const reverse = await wsRequest(wsConn, { type: 'sector', id: to }, 'sectorWarps');
        if (reverse.type === 'sectorWarps' && !reverse.warps.includes(from)) {
          const path = await wsRequest(wsConn, { type: 'path', from: to, to: from }, 'pathResult');
          if (path.type === 'pathResult') {
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

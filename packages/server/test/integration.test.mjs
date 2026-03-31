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
  waitForMsg,
  expectNoMsg,
  closeWS,
  httpGet,
  httpPost,
  wsRequest,
  findPortSector,
  findPortSelling,
  findPortBuying,
  movePlayerTo,
} from './helpers.mjs';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = join(dirname(__filename), '..');

let pool;
let serverProc;

before(async () => {
  // Generate a deterministic 100-sector test universe
  const universeDir = mkdtempSync(join(tmpdir(), 'twnr_test_universe_'));
  try {
    rmSync(universeDir, { recursive: true, force: true });
    const gen = spawnSync(process.execPath, [
      join(PROJECT_ROOT, 'scripts', 'twnr-bigbang.js'),
      universeDir, '--sectors', '100', '--seed', '42',
    ], { encoding: 'utf8', cwd: PROJECT_ROOT });
    if (gen.status !== 0) throw new Error(`bigbang failed: ${gen.stderr}`);

    pool = createPool();
    await pool.query('SELECT 1'); // verify connectivity
    await pool.query('DROP TABLE IF EXISTS ship_cargo, ports, warps, players, sectors CASCADE');
    await pool.end();

    const imp = spawnSync(process.execPath, [
      join(PROJECT_ROOT, 'scripts', 'importUniverse.js'),
      universeDir, '--force',
    ], { encoding: 'utf8', cwd: PROJECT_ROOT, env: process.env });
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

describe('Schema', () => {
  it('sectors table has an integer id column', async () => {
    const res = await pool.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = 'sectors' AND column_name = 'id'`
    );
    assert.equal(res.rows.length, 1, 'sectors table should have an id column');
    assert.ok(res.rows[0].data_type.includes('int'), 'id should be an integer type');
  });

  it('warps table has sector_from and sector_to columns', async () => {
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'warps' ORDER BY column_name`
    );
    const cols = res.rows.map(r => r.column_name);
    assert.ok(cols.includes('sector_from'), 'missing sector_from column');
    assert.ok(cols.includes('sector_to'), 'missing sector_to column');
  });

  it('players table has id, name, and current_sector columns', async () => {
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'players' ORDER BY column_name`
    );
    const cols = res.rows.map(r => r.column_name);
    assert.ok(cols.includes('id'), 'missing id column');
    assert.ok(cols.includes('name'), 'missing name column');
    assert.ok(cols.includes('current_sector'), 'missing current_sector column');
  });

  it('warps table has foreign key referencing sectors', async () => {
    const res = await pool.query(
      `SELECT ccu.table_name AS foreign_table, kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
       WHERE tc.table_name = 'warps' AND tc.constraint_type = 'FOREIGN KEY'`
    );
    const fkTables = res.rows.map(r => r.foreign_table);
    assert.ok(fkTables.includes('sectors'), 'warps should have FK to sectors');
  });

  it('players.current_sector has foreign key referencing sectors', async () => {
    const res = await pool.query(
      `SELECT kcu.column_name, ccu.table_name AS foreign_table
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
       WHERE tc.table_name = 'players' AND tc.constraint_type = 'FOREIGN KEY'`
    );
    const fkCols = res.rows.filter(r => r.foreign_table === 'sectors').map(r => r.column_name);
    assert.ok(fkCols.includes('current_sector'), 'players.current_sector should FK to sectors');
  });
});

describe('Security', () => {
  it('rejects unsigned JWTs on protected REST endpoints', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ playerId: 1, role: 'player' })).toString('base64url');
    const forgedToken = `${header}.${payload}.`;

    const res = await fetch('http://localhost:3000/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${forgedToken}` },
    });
    const body = await res.json();

    assert.equal(res.status, 403);
    assert.equal(body.error, 'Invalid token');
  });

  it('allows WebSocket connections from configured origins', async () => {
    const { ws, welcome } = await connectWS({ origin: 'http://localhost:3000' });

    assert.equal(welcome.type, 'welcome');
    await closeWS(ws);
  });

  it('rejects WebSocket connections from unapproved origins', async () => {
    const { default: WebSocket } = await import('ws');

    await new Promise((resolve, reject) => {
      const ws = new WebSocket('ws://localhost:3000', { origin: 'https://evil.example' });
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error('WS connect timeout'));
      }, 5000);

      ws.on('open', () => {
        clearTimeout(timer);
        ws.close();
        reject(new Error('Unexpectedly connected'));
      });
      ws.on('error', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  });


  it('stores new passwords with scrypt and ignores role from request body', async () => {
    const email = `pilot_${Date.now()}@example.com`;
    const password = 'correct horse battery staple';

    const registerRes = await httpPost('/api/auth/register', {
      name: 'Pilot',
      email,
      password,
      role: 'admin',
    });
    assert.equal(registerRes.status, 201);
    assert.equal(registerRes.body.role, 'player');

    const registered = await pool.query('SELECT password_hash, role FROM players WHERE email = $1', [email]);
    assert.equal(registered.rows[0].role, 'player');
    assert.ok(registered.rows[0].password_hash.startsWith('scrypt$'));
  });

  it('rejects login for accounts with legacy MD5 password hashes', async () => {
    const legacyEmail = `legacy_${Date.now()}@example.com`;
    const legacyHash = '5f4dcc3b5aa765d61d8327deb882cf99'; // md5('password')
    await pool.query(
      'INSERT INTO players (name, email, password_hash, role, current_sector) VALUES ($1, $2, $3, $4, $5)',
      ['Legacy Pilot', legacyEmail, legacyHash, 'player', 1],
    );

    const loginRes = await httpPost('/api/auth/login', { email: legacyEmail, password: 'password' });
    assert.equal(loginRes.status, 401);
  });

});

describe('Universe Generation', () => {
  it('100 sectors exist in the sectors table', async () => {
    const res = await pool.query('SELECT COUNT(*)::int AS count FROM sectors');
    assert.equal(res.rows[0].count, 100, `Expected 100 sectors, got ${res.rows[0].count}`);
  });

  it('every sector has between 1 and 6 warps', async () => {
    const res = await pool.query(
      `SELECT sector_from, COUNT(*)::int AS warp_count
       FROM warps GROUP BY sector_from`
    );
    assert.ok(res.rows.length > 0, 'warps table is empty');
    for (const row of res.rows) {
      assert.ok(
        row.warp_count >= 1 && row.warp_count <= 6,
        `Sector ${row.sector_from} has ${row.warp_count} warps (expected 1-6)`
      );
    }
  });

  it('no self-referential warps exist', async () => {
    const res = await pool.query(
      'SELECT COUNT(*)::int AS count FROM warps WHERE sector_from = sector_to'
    );
    assert.equal(res.rows[0].count, 0, 'Found self-referential warps');
  });

  it('no duplicate warps from the same sector', async () => {
    const res = await pool.query(
      `SELECT sector_from, sector_to, COUNT(*)::int AS cnt
       FROM warps GROUP BY sector_from, sector_to HAVING COUNT(*) > 1`
    );
    assert.equal(res.rows.length, 0, `Found ${res.rows.length} duplicate warp entries`);
  });

  it('all warp targets reference valid sectors', async () => {
    const res = await pool.query(
      `SELECT wl.sector_to FROM warps wl
       LEFT JOIN sectors s ON wl.sector_to = s.id
       WHERE s.id IS NULL`
    );
    assert.equal(res.rows.length, 0, `Found ${res.rows.length} warps pointing to non-existent sectors`);
  });

  it('port inventories are within the valid bigbang range (0-5000)', async () => {
    const res = await pool.query(
      `SELECT MIN(fuel) AS min_f, MAX(fuel) AS max_f,
              MIN(organics) AS min_o, MAX(organics) AS max_o,
              MIN(equipment) AS min_e, MAX(equipment) AS max_e
       FROM ports`
    );
    const row = res.rows[0];
    assert.ok(row.min_f >= 0 && row.max_f <= 5000, `fuel range out of bounds: ${row.min_f}-${row.max_f}`);
    assert.ok(row.min_o >= 0 && row.max_o <= 5000, `organics range out of bounds: ${row.min_o}-${row.max_o}`);
    assert.ok(row.min_e >= 0 && row.max_e <= 5000, `equipment range out of bounds: ${row.min_e}-${row.max_e}`);
  });

  it('approximately 50% of sectors have ports', async () => {
    const res = await pool.query('SELECT COUNT(*)::int AS count FROM ports');
    const count = res.rows[0].count;
    assert.ok(count >= 20 && count <= 80, `Expected roughly 50 ports, got ${count}`);
  });
});

describe('WebSocket', () => {
  it('welcome message sent on connection with playerId and sector', async () => {
    const { ws, welcome } = await connectWS();
    assert.equal(welcome.type, 'welcome');
    assert.ok(welcome.playerId !== undefined, 'welcome should contain playerId');
    assert.equal(welcome.sector, 1, 'player should start in sector 1');
    await closeWS(ws);
  });

  it('display returns sectorDisplay with sector and warps array', async () => {
    const { ws } = await connectWS();
    const msg = await wsRequest(ws, { type: 'display' }, 'sectorDisplay');
    assert.equal(msg.type, 'sectorDisplay');
    assert.ok(typeof msg.sector === 'number', 'sector should be a number');
    assert.ok(Array.isArray(msg.warps), 'warps should be an array');
    assert.ok(msg.warps.length >= 1, 'warps should have at least 1 entry');
    await closeWS(ws);
  });

  it('move to adjacent sector broadcasts playerMoved', async () => {
    const { ws } = await connectWS();

    const disp = await wsRequest(ws, { type: 'display' }, 'sectorDisplay');
    const target = disp.warps[0];
    const moveMsg = await wsRequest(ws, { type: 'move', sector: target }, 'sectorDisplay');

    assert.equal(moveMsg.type, 'sectorDisplay');
    assert.equal(moveMsg.sector, target);
    await closeWS(ws);
  });

  it('playerMoved is received by another player in the origin sector', async () => {
    const { ws: ws1 } = await connectWS();
    const { ws: ws2 } = await connectWS();

    const disp = await wsRequest(ws2, { type: 'display' }, 'sectorDisplay');
    const target = disp.warps[0];
    const broadcastPromise = waitForMsg(ws1, 'playerMoved');
    ws2.send(JSON.stringify({ type: 'move', sector: target }));
    const msg = await broadcastPromise;

    assert.equal(msg.type, 'playerMoved');
    assert.equal(msg.sector, target);
    assert.equal(msg.direction, 'out');
    await closeWS(ws1);
    await closeWS(ws2);
  });

  it('playerMoved is NOT received by a player in an unrelated sector', async () => {
    const { ws: ws1 } = await connectWS();
    const { ws: ws2 } = await connectWS();

    // Move ws1 away from sector 1
    const disp1 = await wsRequest(ws1, { type: 'display' }, 'sectorDisplay');
    const ws1Target = disp1.warps[0];
    const disp1b = await wsRequest(ws1, { type: 'move', sector: ws1Target }, 'sectorDisplay');

    // Move ws1 again so it's two hops away from sector 1
    const ws1Target2 = disp1b.warps.find(w => w !== 1) || disp1b.warps[0];
    await wsRequest(ws1, { type: 'move', sector: ws1Target2 }, 'sectorDisplay');

    // ws2 is still in sector 1 - ws1 should not receive this move
    const disp3 = await wsRequest(ws2, { type: 'display' }, 'sectorDisplay');
    const ws2Target = disp3.warps[0];

    const noMsgPromise = expectNoMsg(ws1, 'playerMoved');
    ws2.send(JSON.stringify({ type: 'move', sector: ws2Target }));
    await noMsgPromise;

    await closeWS(ws1);
    await closeWS(ws2);
  });

  it('nonAdjacentMoveRequested is only sent to the requesting client', async () => {
    const { ws: ws1 } = await connectWS();
    const { ws: ws2 } = await connectWS();

    const disp = await wsRequest(ws2, { type: 'display' }, 'sectorDisplay');
    const warpSet = new Set(disp.warps);
    let nonAdjacent = null;
    for (let i = 1; i <= 100; i++) {
      if (i !== disp.sector && !warpSet.has(i)) { nonAdjacent = i; break; }
    }
    assert.ok(nonAdjacent !== null, 'Could not find a non-adjacent sector');

    const noMsgPromise = expectNoMsg(ws1, 'nonAdjacentMoveRequested');
    const failPromise = waitForMsg(ws2, 'nonAdjacentMoveRequested');
    ws2.send(JSON.stringify({ type: 'move', sector: nonAdjacent }));
    await failPromise;
    await noMsgPromise;

    await closeWS(ws1);
    await closeWS(ws2);
  });

  it('playerLeft is only broadcast to players in the same sector', async () => {
    const { ws: ws1 } = await connectWS();
    const { ws: ws2 } = await connectWS();
    const { ws: ws3 } = await connectWS();

    // Move ws2 away from sector 1
    const disp = await wsRequest(ws2, { type: 'display' }, 'sectorDisplay');
    const target = disp.warps[0];
    await wsRequest(ws2, { type: 'move', sector: target }, 'sectorDisplay');

    // ws1 and ws3 are in sector 1, ws2 is elsewhere
    // ws1 disconnects — ws3 should get playerLeft, ws2 should NOT
    const leftPromise = waitForMsg(ws3, 'playerLeft');
    const noMsgPromise = expectNoMsg(ws2, 'playerLeft');
    ws1.close();
    await leftPromise;
    await noMsgPromise;

    await closeWS(ws2);
    await closeWS(ws3);
  });

  it('move to non-adjacent sector returns nonAdjacentMoveRequested', async () => {
    const { ws } = await connectWS();

    const disp = await wsRequest(ws, { type: 'display' }, 'sectorDisplay');
    const warpSet = new Set(disp.warps);
    let nonAdjacent = null;
    for (let i = 1; i <= 100; i++) {
      if (i !== disp.sector && !warpSet.has(i)) { nonAdjacent = i; break; }
    }
    assert.ok(nonAdjacent !== null, 'Could not find a non-adjacent sector for test');

    const failMsg = await wsRequest(ws, { type: 'move', sector: nonAdjacent }, 'nonAdjacentMoveRequested');
    assert.equal(failMsg.type, 'nonAdjacentMoveRequested');
    assert.equal(failMsg.sector, nonAdjacent);
    await closeWS(ws);
  });

  it('who returns playersOnline with connected player IDs', async () => {
    const { ws } = await connectWS();

    const msg = await wsRequest(ws, { type: 'who' }, 'playersOnline');
    assert.equal(msg.type, 'playersOnline');
    assert.ok(Array.isArray(msg.players), 'players should be an array');
    assert.ok(msg.players.length >= 1, 'should list at least the current player');
    await closeWS(ws);
  });

  it('playerLeft broadcast on disconnect', async () => {
    const { ws: ws1 } = await connectWS();
    const { ws: ws2 } = await connectWS();

    const leftPromise = waitForMsg(ws1, 'playerLeft');
    ws2.close();
    const msg = await leftPromise;

    assert.equal(msg.type, 'playerLeft');
    assert.ok(msg.playerId !== undefined, 'playerLeft should include playerId');
    await closeWS(ws1);
  });

  it('move with missing sector returns error', async () => {
    const { ws } = await connectWS();
    const msg = await wsRequest(ws, { type: 'move' }, 'error');
    assert.equal(msg.type, 'error');
    assert.equal(msg.message, 'Invalid sector');
    await closeWS(ws);
  });

  it('error returned for unknown message type', async () => {
    const { ws } = await connectWS();
    const msg = await wsRequest(ws, { type: 'foobar' }, 'error');
    assert.equal(msg.type, 'error');
    assert.equal(msg.message, 'Unknown message type');
    await closeWS(ws);
  });
});

describe('Sector & Path Queries', () => {
  it('sector query returns sector data with warps', async () => {
    const { ws } = await connectWS();
    const msg = await wsRequest(ws, { type: 'sector', id: 1 }, 'sectorInfo');
    assert.equal(msg.type, 'sectorInfo');
    assert.equal(msg.id, 1);
    assert.ok(Array.isArray(msg.warps), 'warps should be an array');
    assert.ok(msg.warps.length >= 1, 'sector 1 should have at least 1 warp');
    await closeWS(ws);
  });

  it('sector query returns error for nonexistent sector', async () => {
    const { ws } = await connectWS();
    const msg = await wsRequest(ws, { type: 'sector', id: 9999 }, 'sectorInfo');
    assert.equal(msg.type, 'error');
    assert.equal(msg.message, 'Sector not found');
    await closeWS(ws);
  });

  it('sector query returns error for invalid ID', async () => {
    const { ws } = await connectWS();
    const msg = await wsRequest(ws, { type: 'sector', id: -1 }, 'sectorInfo');
    assert.equal(msg.type, 'error');
    assert.equal(msg.message, 'Invalid sector ID');
    await closeWS(ws);
  });

  it('path query returns shortest path between connected sectors', async () => {
    const { ws } = await connectWS();
    const sectorMsg = await wsRequest(ws, { type: 'sector', id: 1 }, 'sectorInfo');
    const target = sectorMsg.warps[0];

    const msg = await wsRequest(ws, { type: 'path', from: 1, to: target }, 'pathResult');
    assert.equal(msg.type, 'pathResult');
    assert.ok(Array.isArray(msg.path), 'path should be an array');
    assert.equal(msg.path[0], 1, 'path should start with origin sector');
    assert.equal(msg.path[msg.path.length - 1], target, 'path should end with target sector');
    assert.equal(msg.hops, msg.path.length - 1, 'hops should equal path length minus 1');
    assert.equal(msg.path.length, 2, 'direct neighbors should have a 2-element path');
    assert.equal(msg.hops, 1);
    await closeWS(ws);
  });

  it('path query with same start and end returns single-element path', async () => {
    const { ws } = await connectWS();
    const msg = await wsRequest(ws, { type: 'path', from: 1, to: 1 }, 'pathResult');
    assert.equal(msg.type, 'pathResult');
    assert.deepStrictEqual(msg.path, [1]);
    assert.equal(msg.hops, 0);
    await closeWS(ws);
  });

  it('path query returns error for invalid parameters', async () => {
    const { ws } = await connectWS();
    const msg = await wsRequest(ws, { type: 'path', from: -1, to: 1 }, 'pathResult');
    assert.equal(msg.type, 'error');
    assert.equal(msg.message, 'Invalid sector ID');
    await closeWS(ws);
  });

  it('path query returns error for nonexistent sectors', async () => {
    const { ws } = await connectWS();
    const msg = await wsRequest(ws, { type: 'path', from: 1, to: 9999 }, 'pathResult');
    assert.equal(msg.type, 'error');
    assert.equal(msg.message, 'Sector not found');
    await closeWS(ws);
  });

  it('path query returns error when no path exists', async () => {
    await pool.query('INSERT INTO sectors (id) VALUES (999) ON CONFLICT DO NOTHING');
    await pool.query('DELETE FROM warps WHERE sector_from = 999 OR sector_to = 999');

    const { ws } = await connectWS();
    const msg = await wsRequest(ws, { type: 'path', from: 1, to: 999 }, 'pathResult');
    assert.equal(msg.type, 'error');
    assert.equal(msg.message, 'No path found');
    await closeWS(ws);

    await pool.query('DELETE FROM sectors WHERE id = 999');
  });

  it('path respects directed warps', async () => {
    const { ws } = await connectWS();
    let found = false;
    for (let from = 1; from <= 100; from++) {
      const res = await wsRequest(ws, { type: 'sector', id: from }, 'sectorInfo');
      if (res.type !== 'sectorInfo') continue;
      for (const to of res.warps) {
        const reverse = await wsRequest(ws, { type: 'sector', id: to }, 'sectorInfo');
        if (reverse.type === 'sectorInfo' && !reverse.warps.includes(from)) {
          const path = await wsRequest(ws, { type: 'path', from: to, to: from }, 'pathResult');
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
    await closeWS(ws);
  });
});

describe('Trading System', () => {
  it('ports table exists with correct columns', async () => {
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'ports' ORDER BY column_name`
    );
    const cols = res.rows.map(r => r.column_name);
    assert.ok(cols.includes('sector_id'), 'missing sector_id');
    assert.ok(cols.includes('class'), 'missing class');
    assert.ok(cols.includes('fuel'), 'missing fuel');
    assert.ok(cols.includes('fuel_price'), 'missing fuel_price');
    assert.ok(cols.includes('organics'), 'missing organics');
    assert.ok(cols.includes('org_price'), 'missing org_price');
    assert.ok(cols.includes('equipment'), 'missing equipment');
    assert.ok(cols.includes('equ_price'), 'missing equ_price');
  });

  it('ship_cargo table exists with correct columns', async () => {
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'ship_cargo' ORDER BY column_name`
    );
    const cols = res.rows.map(r => r.column_name);
    assert.ok(cols.includes('player_id'), 'missing player_id');
    assert.ok(cols.includes('fuel'), 'missing fuel');
    assert.ok(cols.includes('organics'), 'missing organics');
    assert.ok(cols.includes('equipment'), 'missing equipment');
    assert.ok(cols.includes('credits'), 'missing credits');
  });

  it('port query returns port data', async () => {
    const { ws } = await connectWS();
    const portSector = await findPortSector(ws);
    assert.ok(portSector, 'No ports found in any sector');
    const msg = portSector.port;
    assert.equal(msg.type, 'portInfo');
    assert.equal(msg.sectorId, portSector.sectorId);
    assert.ok(typeof msg.class === 'number', 'class should be a number');
    assert.ok(msg.class >= 0 && msg.class <= 9, `class ${msg.class} out of range`);
    assert.ok(typeof msg.fuel === 'number');
    assert.ok(typeof msg.fuelPrice === 'number');
    assert.ok(typeof msg.organics === 'number');
    assert.ok(typeof msg.orgPrice === 'number');
    assert.ok(typeof msg.equipment === 'number');
    assert.ok(typeof msg.equPrice === 'number');
    await closeWS(ws);
  });

  it('port query returns error for sector without port', async () => {
    const { ws } = await connectWS();
    let noPortSector = null;
    for (let i = 1; i <= 100; i++) {
      const res = await wsRequest(ws, { type: 'port', sectorId: i }, 'portInfo');
      if (res.type === 'error') { noPortSector = i; break; }
    }
    assert.ok(noPortSector, 'All sectors have ports — cannot test error');
    const msg = await wsRequest(ws, { type: 'port', sectorId: noPortSector }, 'portInfo');
    assert.equal(msg.type, 'error');
    assert.equal(msg.message, 'No port in this sector');
    await closeWS(ws);
  });

  it('port query returns error for invalid sector ID', async () => {
    const { ws } = await connectWS();
    const msg = await wsRequest(ws, { type: 'port', sectorId: -1 }, 'portInfo');
    assert.equal(msg.type, 'error');
    assert.equal(msg.message, 'Invalid sector ID');
    await closeWS(ws);
  });

  it('cargo query returns cargo and credits', async () => {
    const { ws, welcome } = await connectWS();
    const msg = await wsRequest(ws, { type: 'cargo' }, 'cargoInfo');
    assert.equal(msg.type, 'cargoInfo');
    assert.equal(msg.playerId, welcome.playerId);
    assert.equal(msg.credits, 10000);
    assert.equal(msg.fuel, 0);
    assert.equal(msg.organics, 0);
    assert.equal(msg.equipment, 0);
    await closeWS(ws);
  });

  it('trade buy succeeds and updates cargo and credits', async () => {
    const { ws, welcome } = await connectWS();
    const portSector = await findPortSelling(ws, 'fuel');
    assert.ok(portSector, 'No port found selling fuel');

    const reached = await movePlayerTo(ws, portSector.sectorId);
    assert.ok(reached, `Could not reach port sector ${portSector.sectorId}`);

    const portBefore = await wsRequest(ws, { type: 'port', sectorId: portSector.sectorId }, 'portInfo');
    const qty = 5;
    const msg = await wsRequest(ws, {
      type: 'trade',
      good: 'fuel',
      quantity: qty,
      action: 'buy',
    }, 'tradeResult');
    assert.equal(msg.type, 'tradeResult');
    assert.equal(msg.credits, 10000 - qty * portBefore.fuelPrice);
    assert.equal(msg.cargo.fuel, qty);

    const portAfter = await wsRequest(ws, { type: 'port', sectorId: portSector.sectorId }, 'portInfo');
    assert.equal(portAfter.fuel, portBefore.fuel - qty);

    await closeWS(ws);
  });

  it('trade sell succeeds and updates cargo and credits', async () => {
    const { ws, welcome } = await connectWS();
    const portSector = await findPortBuying(ws, 'organics');
    assert.ok(portSector, 'No port found buying organics');

    const reached = await movePlayerTo(ws, portSector.sectorId);
    assert.ok(reached, `Could not reach port sector ${portSector.sectorId}`);

    // Give the player organics directly so we don't need a separate buy port
    await pool.query('UPDATE ship_cargo SET organics = 10 WHERE player_id = $1', [welcome.playerId]);

    const portBefore = await wsRequest(ws, { type: 'port', sectorId: portSector.sectorId }, 'portInfo');
    const price = portBefore.orgPrice;
    const msg = await wsRequest(ws, {
      type: 'trade',
      good: 'organics',
      quantity: 3,
      action: 'sell',
    }, 'tradeResult');
    assert.equal(msg.type, 'tradeResult');
    assert.equal(msg.cargo.organics, 7); // had 10, sold 3
    assert.equal(msg.credits, 10000 + 3 * price);

    const portAfter = await wsRequest(ws, { type: 'port', sectorId: portSector.sectorId }, 'portInfo');
    assert.equal(portAfter.organics, portBefore.organics + 3);

    await closeWS(ws);
  });

  it('trade returns error for insufficient credits', async () => {
    const { ws } = await connectWS();
    const portSector = await findPortSelling(ws, 'fuel');
    assert.ok(portSector, 'No port found selling fuel');

    const reached = await movePlayerTo(ws, portSector.sectorId);
    assert.ok(reached);

    // Ensure the port has enough inventory so we hit credits check first.
    await pool.query('UPDATE ports SET fuel = 2000 WHERE sector_id = $1', [portSector.sectorId]);

    const msg = await wsRequest(ws, {
      type: 'trade',
      good: 'fuel',
      quantity: 1001,
      action: 'buy',
    }, 'tradeResult');
    assert.equal(msg.type, 'error');
    assert.equal(msg.message, 'Insufficient credits');

    await closeWS(ws);
  });

  it('trade returns error for insufficient port inventory on buy', async () => {
    const { ws, welcome } = await connectWS();
    const portSector = await findPortSelling(ws, 'fuel');
    assert.ok(portSector, 'No port found selling fuel');

    const reached = await movePlayerTo(ws, portSector.sectorId);
    assert.ok(reached);

    // Give player enough credits so we hit inventory check, not credits check
    await pool.query('UPDATE ship_cargo SET credits = 9999999 WHERE player_id = $1', [welcome.playerId]);

    const portInfo = await wsRequest(ws, { type: 'port', sectorId: portSector.sectorId }, 'portInfo');
    const amount = portInfo.fuel + 1; // one more than available

    const msg = await wsRequest(ws, {
      type: 'trade',
      good: 'fuel',
      quantity: amount,
      action: 'buy',
    }, 'tradeResult');
    assert.equal(msg.type, 'error');
    assert.equal(msg.message, 'Insufficient port inventory');
    await closeWS(ws);
  });

  it('trade returns error for insufficient cargo on sell', async () => {
    const { ws } = await connectWS();
    const portSector = await findPortBuying(ws, 'fuel');
    assert.ok(portSector, 'No port found buying fuel');

    const reached = await movePlayerTo(ws, portSector.sectorId);
    assert.ok(reached);

    const msg = await wsRequest(ws, {
      type: 'trade',
      good: 'fuel',
      quantity: 1,
      action: 'sell',
    }, 'tradeResult');
    assert.equal(msg.type, 'error');
    assert.equal(msg.message, 'Insufficient cargo');

    await closeWS(ws);
  });

  it('trade returns error when port does not trade the commodity', async () => {
    const { ws } = await connectWS();
    // Find a port that buys fuel (player can sell but NOT buy)
    const portSector = await findPortBuying(ws, 'fuel');
    assert.ok(portSector, 'No port found buying fuel');

    const reached = await movePlayerTo(ws, portSector.sectorId);
    assert.ok(reached);

    // Try to BUY fuel from a port that only BUYS fuel
    const msg = await wsRequest(ws, {
      type: 'trade',
      good: 'fuel',
      quantity: 1,
      action: 'buy',
    }, 'tradeResult');
    assert.equal(msg.type, 'error');
    assert.equal(msg.message, 'Port does not trade this commodity');

    await closeWS(ws);
  });

  it('trade returns error for invalid fields', async () => {
    const { ws } = await connectWS();

    const msg1 = await wsRequest(ws, {
      type: 'trade',
      good: 'unobtanium',
      quantity: 1,
      action: 'buy',
    }, 'tradeResult');
    assert.equal(msg1.type, 'error');
    assert.equal(msg1.message, 'Invalid good');

    const msg2 = await wsRequest(ws, {
      type: 'trade',
      good: 'fuel',
      quantity: 1,
      action: 'barter',
    }, 'tradeResult');
    assert.equal(msg2.type, 'error');
    assert.equal(msg2.message, 'Invalid action');

    await closeWS(ws);
  });

  it('trade returns error when not at a port', async () => {
    const { ws } = await connectWS();
    let noPortSector = null;
    for (let i = 1; i <= 100; i++) {
      const res = await wsRequest(ws, { type: 'port', sectorId: i }, 'portInfo');
      if (res.type === 'error') { noPortSector = i; break; }
    }
    assert.ok(noPortSector, 'All sectors have ports');

    const reached = await movePlayerTo(ws, noPortSector);
    assert.ok(reached, `Could not reach sector ${noPortSector}`);

    const msg = await wsRequest(ws, {
      type: 'trade',
      good: 'fuel',
      quantity: 1,
      action: 'buy',
    }, 'tradeResult');
    assert.equal(msg.type, 'error');
    assert.equal(msg.message, 'No port in this sector');

    await closeWS(ws);
  });

  it('concurrent trades do not corrupt port inventory', async () => {
    const { ws: ws1, welcome: w1 } = await connectWS();
    const { ws: ws2, welcome: w2 } = await connectWS();

    const portSector = await findPortSector(ws1);
    assert.ok(portSector, 'No ports found');

    const r1 = await movePlayerTo(ws1, portSector.sectorId);
    const r2 = await movePlayerTo(ws2, portSector.sectorId);
    assert.ok(r1 && r2, 'Could not move both players to port');

    const portBefore = await wsRequest(ws1, { type: 'port', sectorId: portSector.sectorId }, 'portInfo');
    const availableFuel = portBefore.fuel;
    const buyAmount = Math.floor(availableFuel * 0.7);

    // Find a port that sells fuel for this test
    // The port found by findPortSector may not sell fuel, so find one that does
    const sellingPort = await findPortSelling(ws1, 'fuel');
    if (!sellingPort) {
      // Skip if no port sells fuel — can't test concurrent buys
      await closeWS(ws1);
      await closeWS(ws2);
      return;
    }

    await movePlayerTo(ws1, sellingPort.sectorId);
    await movePlayerTo(ws2, sellingPort.sectorId);

    const portBeforeTrade = await wsRequest(ws1, { type: 'port', sectorId: sellingPort.sectorId }, 'portInfo');
    const availFuel = portBeforeTrade.fuel;
    const buyAmt = Math.floor(availFuel * 0.7);

    const [res1, res2] = await Promise.all([
      wsRequest(ws1, { type: 'trade', good: 'fuel', quantity: buyAmt, action: 'buy' }, 'tradeResult'),
      wsRequest(ws2, { type: 'trade', good: 'fuel', quantity: buyAmt, action: 'buy' }, 'tradeResult'),
    ]);

    const portAfter = await wsRequest(ws1, { type: 'port', sectorId: sellingPort.sectorId }, 'portInfo');
    assert.ok(portAfter.fuel >= 0, `Port fuel went negative: ${portAfter.fuel}`);

    if (buyAmt * 2 > availFuel) {
      const successes = [res1, res2].filter(r => r.type === 'tradeResult').length;
      assert.ok(successes <= 1,
        `Both trades succeeded but combined quantity (${buyAmt * 2}) exceeds available (${availFuel})`);
    }

    await closeWS(ws1);
    await closeWS(ws2);
  });
});

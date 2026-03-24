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
  it('rejects unsigned JWTs on protected endpoints', async () => {
    const { ws, welcome } = await connectWS();
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ playerId: welcome.playerId, role: 'player' })).toString('base64url');
    const forgedToken = `${header}.${payload}.`;

    const res = await fetch(`http://localhost:3000/api/ship/${welcome.playerId}`, {
      headers: { Authorization: `Bearer ${forgedToken}` },
    });
    const body = await res.json();

    assert.equal(res.status, 403);
    assert.equal(body.error, 'Invalid token');
    await closeWS(ws);
  });

  it('accepts protected HTTP calls via WebSocket session cookie for compatibility', async () => {
    const { ws, welcome, cookies } = await connectWS();
    const sessionCookie = cookies.find(cookie => cookie.startsWith('twnr_session='));

    assert.ok(sessionCookie, 'WebSocket handshake should set a compatibility session cookie');

    const res = await fetch(`http://localhost:3000/api/cargo/${welcome.playerId}`, {
      headers: {
        Cookie: sessionCookie.split(';')[0],
      },
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.playerId, welcome.playerId);
    await closeWS(ws);
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


  it('stores new passwords with scrypt and upgrades legacy md5 hashes on login', async () => {
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

    const legacyEmail = `legacy_${Date.now()}@example.com`;
    const legacyHash = '5f4dcc3b5aa765d61d8327deb882cf99';
    await pool.query(
      'INSERT INTO players (name, email, password_hash, role, current_sector) VALUES ($1, $2, $3, $4, $5)',
      ['Legacy Pilot', legacyEmail, legacyHash, 'player', 1],
    );

    const loginRes = await httpPost('/api/auth/login', { email: legacyEmail, password: 'password' });
    assert.equal(loginRes.status, 200);

    const upgraded = await pool.query('SELECT password_hash FROM players WHERE email = $1', [legacyEmail]);
    assert.ok(upgraded.rows[0].password_hash.startsWith('scrypt$'));
  });

  it('treats player search input as data, not SQL', async () => {
    await pool.query(
      'INSERT INTO players (name, email, password_hash, role, current_sector) VALUES ($1, $2, $3, $4, $5)',
      ['SearchTarget', `search_${Date.now()}@example.com`, 'irrelevant', 'player', 1],
    );

    const { status, body } = await httpGet("/api/players/search?name=' UNION SELECT id,password_hash,current_sector FROM players -- ");
    assert.equal(status, 200);
    assert.equal(body.players.length, 0);
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
    const promise = waitForMsg(ws, 'sectorDisplay');
    ws.send(JSON.stringify({ type: 'display' }));
    const msg = await promise;
    assert.equal(msg.type, 'sectorDisplay');
    assert.ok(typeof msg.sector === 'number', 'sector should be a number');
    assert.ok(Array.isArray(msg.warps), 'warps should be an array');
    assert.ok(msg.warps.length >= 1, 'warps should have at least 1 entry');
    await closeWS(ws);
  });

  it('move to adjacent sector broadcasts playerMoved', async () => {
    const { ws } = await connectWS();

    const dispPromise = waitForMsg(ws, 'sectorDisplay');
    ws.send(JSON.stringify({ type: 'display' }));
    const disp = await dispPromise;

    const target = disp.warps[0];
    const movePromise = waitForMsg(ws, 'sectorDisplay');
    ws.send(JSON.stringify({ type: 'move', sector: target }));
    const moveMsg = await movePromise;

    assert.equal(moveMsg.type, 'sectorDisplay');
    assert.equal(moveMsg.sector, target);
    await closeWS(ws);
  });

  it('playerMoved is received by another player in the origin sector', async () => {
    const { ws: ws1 } = await connectWS();
    const { ws: ws2 } = await connectWS();

    const dispPromise = waitForMsg(ws2, 'sectorDisplay');
    ws2.send(JSON.stringify({ type: 'display' }));
    const disp = await dispPromise;

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
    const disp1Promise = waitForMsg(ws1, 'sectorDisplay');
    ws1.send(JSON.stringify({ type: 'display' }));
    const disp1 = await disp1Promise;
    const ws1Target = disp1.warps[0];
    const move1Promise = waitForMsg(ws1, 'sectorDisplay');
    ws1.send(JSON.stringify({ type: 'move', sector: ws1Target }));
    const disp1b = await move1Promise;

    // Move ws1 again so it's two hops away from sector 1
    const ws1Target2 = disp1b.warps.find(w => w !== 1) || disp1b.warps[0];
    const move2Promise = waitForMsg(ws1, 'sectorDisplay');
    ws1.send(JSON.stringify({ type: 'move', sector: ws1Target2 }));
    await move2Promise;

    // ws2 is still in sector 1 - ws1 should not receive this move
    const disp3Promise = waitForMsg(ws2, 'sectorDisplay');
    ws2.send(JSON.stringify({ type: 'display' }));
    const disp3 = await disp3Promise;
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

    const dispPromise = waitForMsg(ws2, 'sectorDisplay');
    ws2.send(JSON.stringify({ type: 'display' }));
    const disp = await dispPromise;
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
    const dispPromise = waitForMsg(ws2, 'sectorDisplay');
    ws2.send(JSON.stringify({ type: 'display' }));
    const disp = await dispPromise;
    const target = disp.warps[0];
    const movePromise = waitForMsg(ws2, 'sectorDisplay');
    ws2.send(JSON.stringify({ type: 'move', sector: target }));
    await movePromise;

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

    const dispPromise = waitForMsg(ws, 'sectorDisplay');
    ws.send(JSON.stringify({ type: 'display' }));
    const disp = await dispPromise;

    const warpSet = new Set(disp.warps);
    let nonAdjacent = null;
    for (let i = 1; i <= 100; i++) {
      if (i !== disp.sector && !warpSet.has(i)) { nonAdjacent = i; break; }
    }
    assert.ok(nonAdjacent !== null, 'Could not find a non-adjacent sector for test');

    const failPromise = waitForMsg(ws, 'nonAdjacentMoveRequested');
    ws.send(JSON.stringify({ type: 'move', sector: nonAdjacent }));
    const failMsg = await failPromise;

    assert.equal(failMsg.type, 'nonAdjacentMoveRequested');
    assert.equal(failMsg.sector, nonAdjacent);
    await closeWS(ws);
  });

  it('who returns playersOnline with connected player IDs', async () => {
    const { ws } = await connectWS();

    const promise = waitForMsg(ws, 'playersOnline');
    ws.send(JSON.stringify({ type: 'who' }));
    const msg = await promise;

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
});

describe('REST API', () => {
  it('GET /api/sector/:id returns sector data with warps', async () => {
    const { status, body } = await httpGet('/api/sector/1');
    assert.equal(status, 200);
    assert.equal(body.id, 1);
    assert.ok(Array.isArray(body.warps), 'warps should be an array');
    assert.ok(body.warps.length >= 1, 'sector 1 should have at least 1 warp');
  });

  it('GET /api/sector/:id returns 404 for nonexistent sector', async () => {
    const { status, body } = await httpGet('/api/sector/9999');
    assert.equal(status, 404);
    assert.equal(body.error, 'Sector not found');
  });

  it('GET /api/sector/:id returns 400 for invalid ID', async () => {
    const { status, body } = await httpGet('/api/sector/abc');
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid sector ID');
  });

  it('GET /api/players/online lists connected players with sectors', async () => {
    const { ws } = await connectWS();

    const { status, body } = await httpGet('/api/players/online');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.players), 'players should be an array');
    assert.ok(body.players.length >= 1, 'should list at least one player');
    const player = body.players[0];
    assert.ok(player.playerId !== undefined, 'each player should have playerId');
    assert.ok(typeof player.sector === 'number', 'each player should have numeric sector');

    await closeWS(ws);
  });

  it('GET /api/players/online returns empty array when nobody connected', async () => {
    let response = null;
    for (let i = 0; i < 20; i++) {
      response = await httpGet('/api/players/online');
      if (response.body.players.length === 0) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body.players));
    assert.equal(response.body.players.length, 0);
  });

  it('POST /api/move succeeds for valid adjacent move', async () => {
    const { ws, welcome } = await connectWS();

    const dispPromise = waitForMsg(ws, 'sectorDisplay');
    ws.send(JSON.stringify({ type: 'display' }));
    const disp = await dispPromise;
    const target = disp.warps[0];

    const movePromise = waitForMsg(ws, 'sectorDisplay');
    const { status, body } = await httpPost('/api/move', {
      targetSector: target,
    }, { authPlayerId: welcome.playerId });
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.sector, target);
    assert.ok(Array.isArray(body.warps), 'response should include warps for new sector');

    const wsMsg = await movePromise;
    assert.equal(wsMsg.type, 'sectorDisplay');
    assert.equal(wsMsg.sector, target);

    await closeWS(ws);
  });

  it('POST /api/move returns 400 for non-adjacent sector', async () => {
    const { ws, welcome } = await connectWS();

    const dispPromise = waitForMsg(ws, 'sectorDisplay');
    ws.send(JSON.stringify({ type: 'display' }));
    const disp = await dispPromise;
    const warpSet = new Set(disp.warps);
    let nonAdjacent = null;
    for (let i = 1; i <= 100; i++) {
      if (i !== disp.sector && !warpSet.has(i)) { nonAdjacent = i; break; }
    }
    assert.ok(nonAdjacent !== null);

    const { status, body } = await httpPost('/api/move', {
      targetSector: nonAdjacent,
    }, { authPlayerId: welcome.playerId });
    assert.equal(status, 400);
    assert.equal(body.error, 'Not adjacent');

    await closeWS(ws);
  });

  it('POST /api/move returns 404 for unknown player', async () => {
    const { status, body } = await httpPost('/api/move', {
      targetSector: 1,
    }, { authPlayerId: 99999 });
    assert.equal(status, 404);
    assert.equal(body.error, 'Player not found');
  });

  it('POST /api/move returns 400 when fields are missing', async () => {
    const { status, body } = await httpPost('/api/move', {});
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid request');
  });
});

describe('Pathfinding', () => {
  it('GET /api/route/:from/:to returns shortest path between connected sectors', async () => {
    const sectorRes = await httpGet('/api/sector/1');
    assert.equal(sectorRes.status, 200);
    const target = sectorRes.body.warps[0];

    const { status, body } = await httpGet(`/api/route/1/${target}`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.path), 'path should be an array');
    assert.equal(body.path[0], 1, 'path should start with origin sector');
    assert.equal(body.path[body.path.length - 1], target, 'path should end with target sector');
    assert.equal(body.hops, body.path.length - 1, 'hops should equal path length minus 1');
    assert.equal(body.path.length, 2, 'direct neighbors should have a 2-element path');
    assert.equal(body.hops, 1);
  });

  it('GET /api/route/:from/:to with same start and end returns single-element path', async () => {
    const { status, body } = await httpGet('/api/route/1/1');
    assert.equal(status, 200);
    assert.deepStrictEqual(body.path, [1]);
    assert.equal(body.hops, 0);
  });

  it('GET /api/route/:from/:to returns 400 for non-integer parameters', async () => {
    const { status, body } = await httpGet('/api/route/abc/1');
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid sector ID');

    const res2 = await httpGet('/api/route/1/xyz');
    assert.equal(res2.status, 400);
    assert.equal(res2.body.error, 'Invalid sector ID');
  });

  it('GET /api/route/:from/:to returns 404 for nonexistent sectors', async () => {
    const { status, body } = await httpGet('/api/route/1/9999');
    assert.equal(status, 404);
    assert.equal(body.error, 'Sector not found');
  });

  it('GET /api/route returns 404 when no path exists', async () => {
    await pool.query('INSERT INTO sectors (id) VALUES (999) ON CONFLICT DO NOTHING');
    await pool.query('DELETE FROM warps WHERE sector_from = 999 OR sector_to = 999');
    const { status, body } = await httpGet('/api/route/1/999');
    assert.equal(status, 404);
    assert.equal(body.error, 'No route found');
    await pool.query('DELETE FROM sectors WHERE id = 999');
  });

  it('GET /api/route respects directed warps', async () => {
    let found = false;
    for (let from = 1; from <= 100; from++) {
      const res = await httpGet(`/api/sector/${from}`);
      if (res.status !== 200) continue;
      for (const to of res.body.warps) {
        const reverse = await httpGet(`/api/sector/${to}`);
        if (reverse.status === 200 && !reverse.body.warps.includes(from)) {
          const route = await httpGet(`/api/route/${to}/${from}`);
          if (route.status === 200) {
            assert.ok(route.body.hops > 1,
              `Route from ${to} to ${from} should not be 1 hop since no direct warp exists`);
          }
          found = true;
          break;
        }
      }
      if (found) break;
    }
    assert.ok(found, 'Could not find an asymmetric warp pair to test directionality');
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

  it('GET /api/port/:sectorId returns port data', async () => {
    const portSector = await findPortSector();
    assert.ok(portSector, 'No ports found in any sector');
    const { status, body } = await httpGet(`/api/port/${portSector.sectorId}`);
    assert.equal(status, 200);
    assert.equal(body.sectorId, portSector.sectorId);
    assert.ok(typeof body.class === 'number', 'class should be a number');
    assert.ok(body.class >= 0 && body.class <= 9, `class ${body.class} out of range`);
    assert.ok(typeof body.fuel === 'number');
    assert.ok(typeof body.fuelPrice === 'number');
    assert.ok(typeof body.organics === 'number');
    assert.ok(typeof body.orgPrice === 'number');
    assert.ok(typeof body.equipment === 'number');
    assert.ok(typeof body.equPrice === 'number');
  });

  it('GET /api/port returns 404 for sector without port', async () => {
    let noPortSector = null;
    for (let i = 1; i <= 100; i++) {
      const res = await httpGet(`/api/port/${i}`);
      if (res.status === 404) { noPortSector = i; break; }
    }
    assert.ok(noPortSector, 'All sectors have ports — cannot test 404');
    const { status, body } = await httpGet(`/api/port/${noPortSector}`);
    assert.equal(status, 404);
    assert.equal(body.error, 'No port in this sector');
  });

  it('GET /api/port returns 400 for invalid sector ID', async () => {
    const { status, body } = await httpGet('/api/port/abc');
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid sector ID');
  });

  it('GET /api/cargo/:playerId returns cargo and credits', async () => {
    const { ws, welcome } = await connectWS();
    const { status, body } = await httpGet(`/api/cargo/${welcome.playerId}`);
    assert.equal(status, 200);
    assert.equal(body.playerId, welcome.playerId);
    assert.equal(body.credits, 10000);
    assert.equal(body.fuel, 0);
    assert.equal(body.organics, 0);
    assert.equal(body.equipment, 0);
    await closeWS(ws);
  });

  it('GET /api/cargo returns 404 for unknown player', async () => {
    const { status, body } = await httpGet('/api/cargo/99999');
    assert.equal(status, 404);
    assert.equal(body.error, 'Player not found');
  });

  it('POST /api/trade buy succeeds and updates cargo and credits', async () => {
    const portSector = await findPortSelling('fuel');
    assert.ok(portSector, 'No port found selling fuel');

    const { ws, welcome } = await connectWS();
    const reached = await movePlayerTo(ws, portSector.sectorId);
    assert.ok(reached, `Could not reach port sector ${portSector.sectorId}`);

    const portBefore = (await httpGet(`/api/port/${portSector.sectorId}`)).body;
    const qty = 5;
    const { status, body } = await httpPost('/api/trade', {
      good: 'fuel',
      quantity: qty,
      action: 'buy',
    }, { authPlayerId: welcome.playerId });
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.credits, 10000 - qty * portBefore.fuelPrice);
    assert.equal(body.cargo.fuel, qty);

    const portAfter = (await httpGet(`/api/port/${portSector.sectorId}`)).body;
    assert.equal(portAfter.fuel, portBefore.fuel - qty);

    await closeWS(ws);
  });

  it('POST /api/trade sell succeeds and updates cargo and credits', async () => {
    const portSector = await findPortBuying('organics');
    assert.ok(portSector, 'No port found buying organics');

    const { ws, welcome } = await connectWS();
    const reached = await movePlayerTo(ws, portSector.sectorId);
    assert.ok(reached, `Could not reach port sector ${portSector.sectorId}`);

    // Give the player organics directly so we don't need a separate buy port
    await pool.query('UPDATE ship_cargo SET organics = 10 WHERE player_id = $1', [welcome.playerId]);

    const portBefore = (await httpGet(`/api/port/${portSector.sectorId}`)).body;
    const price = portBefore.orgPrice;
    const { status, body } = await httpPost('/api/trade', {
      good: 'organics',
      quantity: 3,
      action: 'sell',
    }, { authPlayerId: welcome.playerId });
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.cargo.organics, 7); // had 10, sold 3
    assert.equal(body.credits, 10000 + 3 * price);

    const portAfter = (await httpGet(`/api/port/${portSector.sectorId}`)).body;
    assert.equal(portAfter.organics, portBefore.organics + 3);

    await closeWS(ws);
  });

  it('POST /api/trade returns 400 for insufficient credits', async () => {
    const portSector = await findPortSelling('fuel');
    assert.ok(portSector, 'No port found selling fuel');

    const { ws, welcome } = await connectWS();
    const reached = await movePlayerTo(ws, portSector.sectorId);
    assert.ok(reached);

    // Ensure the port has enough inventory so we hit credits check first.
    // Port sell prices are 10-50; at min price 10, buying 1001 costs 10010 > 10000 credits.
    await pool.query('UPDATE ports SET fuel = 2000 WHERE sector_id = $1', [portSector.sectorId]);

    const { status, body } = await httpPost('/api/trade', {
      good: 'fuel',
      quantity: 1001,
      action: 'buy',
    }, { authPlayerId: welcome.playerId });
    assert.equal(status, 400);
    assert.equal(body.error, 'Insufficient credits');

    await closeWS(ws);
  });

  it('POST /api/trade returns 400 for insufficient port inventory on buy', async () => {
    const portSector = await findPortSelling('fuel');
    assert.ok(portSector, 'No port found selling fuel');

    const { ws, welcome } = await connectWS();
    const reached = await movePlayerTo(ws, portSector.sectorId);
    assert.ok(reached);

    // Give player enough credits so we hit inventory check, not credits check
    await pool.query('UPDATE ship_cargo SET credits = 9999999 WHERE player_id = $1', [welcome.playerId]);

    const portInfo = (await httpGet(`/api/port/${portSector.sectorId}`)).body;
    const amount = portInfo.fuel + 1; // one more than available

    const { status, body } = await httpPost('/api/trade', {
      good: 'fuel',
      quantity: amount,
      action: 'buy',
    }, { authPlayerId: welcome.playerId });
    assert.equal(status, 400);
    assert.equal(body.error, 'Insufficient port inventory');
    await closeWS(ws);
  });

  it('POST /api/trade returns 400 for insufficient cargo on sell', async () => {
    const portSector = await findPortBuying('fuel');
    assert.ok(portSector, 'No port found buying fuel');

    const { ws, welcome } = await connectWS();
    const reached = await movePlayerTo(ws, portSector.sectorId);
    assert.ok(reached);

    const { status, body } = await httpPost('/api/trade', {
      good: 'fuel',
      quantity: 1,
      action: 'sell',
    }, { authPlayerId: welcome.playerId });
    assert.equal(status, 400);
    assert.equal(body.error, 'Insufficient cargo');

    await closeWS(ws);
  });

  it('POST /api/trade returns 400 when port does not trade the commodity', async () => {
    // Find a port that buys fuel (player can sell but NOT buy)
    const portSector = await findPortBuying('fuel');
    assert.ok(portSector, 'No port found buying fuel');

    const { ws, welcome } = await connectWS();
    const reached = await movePlayerTo(ws, portSector.sectorId);
    assert.ok(reached);

    // Try to BUY fuel from a port that only BUYS fuel
    const { status, body } = await httpPost('/api/trade', {
      good: 'fuel',
      quantity: 1,
      action: 'buy',
    }, { authPlayerId: welcome.playerId });
    assert.equal(status, 400);
    assert.equal(body.error, 'Port does not trade this commodity');

    await closeWS(ws);
  });

  it('POST /api/trade returns 400 for invalid fields', async () => {
    const { status: s1, body: b1 } = await httpPost('/api/trade', {});
    assert.equal(s1, 400);
    assert.equal(b1.error, 'Invalid request');

    const { status: s2, body: b2 } = await httpPost('/api/trade', {
      good: 'unobtanium', quantity: 1, action: 'buy',
    }, { authPlayerId: 1 });
    assert.equal(s2, 400);
    assert.equal(b2.error, 'Invalid request');

    const { status: s3, body: b3 } = await httpPost('/api/trade', {
      good: 'fuel', quantity: 1, action: 'barter',
    }, { authPlayerId: 1 });
    assert.equal(s3, 400);
    assert.equal(b3.error, 'Invalid request');
  });

  it('POST /api/trade returns 404 when not at a port', async () => {
    let noPortSector = null;
    for (let i = 1; i <= 100; i++) {
      const res = await httpGet(`/api/port/${i}`);
      if (res.status === 404) { noPortSector = i; break; }
    }
    assert.ok(noPortSector, 'All sectors have ports');

    const { ws, welcome } = await connectWS();
    const reached = await movePlayerTo(ws, noPortSector);
    assert.ok(reached, `Could not reach sector ${noPortSector}`);

    const { status, body } = await httpPost('/api/trade', {
      good: 'fuel',
      quantity: 1,
      action: 'buy',
    }, { authPlayerId: welcome.playerId });
    assert.equal(status, 404);
    assert.equal(body.error, 'No port in this sector');

    await closeWS(ws);
  });

  it('concurrent trades do not corrupt port inventory', async () => {
    const portSector = await findPortSector();
    assert.ok(portSector, 'No ports found');

    const { ws: ws1, welcome: w1 } = await connectWS();
    const { ws: ws2, welcome: w2 } = await connectWS();
    const r1 = await movePlayerTo(ws1, portSector.sectorId);
    const r2 = await movePlayerTo(ws2, portSector.sectorId);
    assert.ok(r1 && r2, 'Could not move both players to port');

    const portBefore = (await httpGet(`/api/port/${portSector.sectorId}`)).body;
    const availableFuel = portBefore.fuel;
    const buyAmount = Math.floor(availableFuel * 0.7);

    const [res1, res2] = await Promise.all([
      httpPost('/api/trade', { good: 'fuel', quantity: buyAmount, action: 'buy' }, { authPlayerId: w1.playerId }),
      httpPost('/api/trade', { good: 'fuel', quantity: buyAmount, action: 'buy' }, { authPlayerId: w2.playerId }),
    ]);

    const portAfter = (await httpGet(`/api/port/${portSector.sectorId}`)).body;
    assert.ok(portAfter.fuel >= 0, `Port fuel went negative: ${portAfter.fuel}`);

    if (buyAmount * 2 > availableFuel) {
      const successes = [res1, res2].filter(r => r.status === 200).length;
      assert.ok(successes <= 1,
        `Both trades succeeded but combined quantity (${buyAmount * 2}) exceeds available (${availableFuel})`);
    }

    await closeWS(ws1);
    await closeWS(ws2);
  });
});

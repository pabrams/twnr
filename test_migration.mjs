#!/usr/bin/env node

// self-contained migration verification tests
// Uses Node built-in assert and a micro test runner for exact output control.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const results = [];

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, pass: true });
    console.log(`  PASS: ${name}`);
  } catch (e) {
    results.push({ name, pass: false, error: e.message });
    console.log(`  FAIL: ${name}`);
    console.log(`    Error: ${e.message}`);
  }
}

function report() {
  const total = results.length;
  const passed = results.filter(r => r.pass).length;
  console.log(`\nTests ran: ${total}`);
  console.log(`Tests passed: ${passed}`);
  if (passed === total && total > 0) {
    console.log('SUCCESS');
    process.exit(0);
  } else {
    console.log('FAILURE');
    process.exit(1);
  }
}

let pool = null;
let serverProc = null;
let serverReady = false;

async function initPool() {
  const pg = await import('pg');
  pool = new pg.default.Pool({
    host: 'localhost',
    database: 'twnr',
    user: 'twnr_user',
    password: 'twnr_pass',
  });
  // Quick connectivity check
  await pool.query('SELECT 1');
}

function startServer() {
  return new Promise((resolve, reject) => {
    serverProc = spawn('node', ['dist/server.js'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error('Server start timeout (10 s)')); }
    }, 10000);

    serverProc.stdout.on('data', (d) => {
      const out = d.toString();
      // The server prints a listening message on startup
      if (!settled && (out.includes('listening') || out.includes('3000'))) {
        settled = true;
        clearTimeout(timeout);
        setTimeout(resolve, 1500); // extra time for universe generation
      }
    });

    serverProc.stderr.on('data', (d) => {
      // Surface server errors for debugging
      const text = d.toString().trim();
      if (text) console.log(`    [server stderr] ${text}`);
    });

    serverProc.on('error', (err) => {
      if (!settled) { settled = true; clearTimeout(timeout); reject(err); }
    });
    serverProc.on('exit', (code) => {
      if (!settled) { settled = true; clearTimeout(timeout); reject(new Error(`Server exited with code ${code}`)); }
    });
  });
}

function connectWS() {
  return import('ws').then(({ default: WebSocket }) => {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket('ws://localhost:3000');
      const timer = setTimeout(() => { ws.terminate(); reject(new Error('WS connect timeout')); }, 5000);

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'welcome') {
          clearTimeout(timer);
          resolve({ ws, welcome: msg });
        }
      });
      ws.on('error', (err) => { clearTimeout(timer); reject(err); });
    });
  });
}

function waitForMsg(ws, type, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for message type "${type}"`)), timeout);
    function handler(data) {
      const msg = JSON.parse(data.toString());
      if (msg.type === type) {
        clearTimeout(timer);
        ws.removeListener('message', handler);
        resolve(msg);
      }
    }
    ws.on('message', handler);
  });
}

function closeWS(ws) {
  return new Promise((resolve) => {
    if (!ws || ws.readyState > 1) { resolve(); return; }
    ws.on('close', resolve);
    ws.close();
    setTimeout(resolve, 1000);   // safety timeout
  });
}

// Test suites

async function runAll() {

  // Dependency tests
  console.log('\nDependency Tests');

  await test('pg is listed in package.json dependencies', async () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    assert.ok(pkg.dependencies && pkg.dependencies.pg,
      'pg should be in dependencies');
  });

  await test('mongoose is not in package.json dependencies', async () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const inDeps = pkg.dependencies && pkg.dependencies.mongoose;
    const inDev  = pkg.devDependencies && pkg.devDependencies.mongoose;
    assert.ok(!inDeps && !inDev,
      'mongoose should not appear in dependencies or devDependencies');
  });

  // Schema tests
  console.log('\nSchema Tests');

  let poolOk = false;
  try {
    await initPool();
    poolOk = true;
  } catch (e) {
    console.log(`  (pool init failed: ${e.message})`);
  }

  // Try starting the server so it can create tables and generate universe
  if (poolOk) {
    try {
      await startServer();
      serverReady = true;
      // allow time for universe generation
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      console.log(`  (server did not start: ${e.message})`);
    }
  }

  await test('sectors table exists with integer id column', async () => {
    assert.ok(poolOk, 'No database connection');
    const res = await pool.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = 'sectors' AND column_name = 'id'`
    );
    assert.ok(res.rows.length === 1, 'sectors table should have an id column');
    assert.ok(res.rows[0].data_type.includes('int'), 'id should be an integer type');
  });

  await test('warps table has sector_from and sector_to columns', async () => {
    assert.ok(poolOk, 'No database connection');
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'warps' ORDER BY column_name`
    );
    const cols = res.rows.map(r => r.column_name);
    assert.ok(cols.includes('sector_from'), 'missing sector_from column');
    assert.ok(cols.includes('sector_to'),   'missing sector_to column');
  });

  await test('players table has id, name, and current_sector columns', async () => {
    assert.ok(poolOk, 'No database connection');
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'players' ORDER BY column_name`
    );
    const cols = res.rows.map(r => r.column_name);
    assert.ok(cols.includes('id'),             'missing id column');
    assert.ok(cols.includes('name'),           'missing name column');
    assert.ok(cols.includes('current_sector'), 'missing current_sector column');
  });

  await test('warps table has foreign key referencing sectors', async () => {
    assert.ok(poolOk, 'No database connection');
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

  await test('players.current_sector has foreign key referencing sectors', async () => {
    assert.ok(poolOk, 'No database connection');
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

  // Universe generation tests
  console.log('\nUniverse Generation Tests');

  await test('100 sectors exist in the sectors table', async () => {
    assert.ok(poolOk, 'No database connection');
    const res = await pool.query('SELECT COUNT(*)::int AS count FROM sectors');
    assert.equal(res.rows[0].count, 100, `Expected 100 sectors, got ${res.rows[0].count}`);
  });

  await test('every sector has between 1 and 6 warps', async () => {
    assert.ok(poolOk, 'No database connection');
    const res = await pool.query(
      `SELECT sector_from, COUNT(*)::int AS warp_count
       FROM warps GROUP BY sector_from`
    );
    assert.ok(res.rows.length > 0, 'warps table is empty');
    for (const row of res.rows) {
      assert.ok(row.warp_count >= 1 && row.warp_count <= 6,
        `Sector ${row.sector_from} has ${row.warp_count} warps (expected 1-6)`);
    }
  });

  await test('no self-referential warps exist', async () => {
    assert.ok(poolOk, 'No database connection');
    const res = await pool.query(
      'SELECT COUNT(*)::int AS count FROM warps WHERE sector_from = sector_to'
    );
    assert.equal(res.rows[0].count, 0, 'Found self-referential warps');
  });

  await test('no duplicate warps from the same sector', async () => {
    assert.ok(poolOk, 'No database connection');
    const res = await pool.query(
      `SELECT sector_from, sector_to, COUNT(*)::int AS cnt
       FROM warps GROUP BY sector_from, sector_to HAVING COUNT(*) > 1`
    );
    assert.equal(res.rows.length, 0,
      `Found ${res.rows.length} duplicate warp entries`);
  });

  await test('all warp targets reference valid sectors', async () => {
    assert.ok(poolOk, 'No database connection');
    const res = await pool.query(
      `SELECT wl.sector_to FROM warps wl
       LEFT JOIN sectors s ON wl.sector_to = s.id
       WHERE s.id IS NULL`
    );
    assert.equal(res.rows.length, 0,
      `Found ${res.rows.length} warps pointing to non-existent sectors`);
  });

  // WebSocket tests
  console.log('\nWebSocket Tests');

  await test('welcome message sent on connection with playerId and sector', async () => {
    assert.ok(serverReady, 'Server not running');
    const { ws, welcome } = await connectWS();
    assert.equal(welcome.type, 'welcome');
    assert.ok(welcome.playerId !== undefined, 'welcome should contain playerId');
    assert.ok(typeof welcome.sector === 'number', 'welcome should contain numeric sector');
    await closeWS(ws);
  });

  await test('display returns sectorDisplay with sector and warps array', async () => {
    assert.ok(serverReady, 'Server not running');
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

  await test('move to adjacent sector broadcasts playerMoved', async () => {
    assert.ok(serverReady, 'Server not running');
    const { ws } = await connectWS();

    // Get current warps
    const dispPromise = waitForMsg(ws, 'sectorDisplay');
    ws.send(JSON.stringify({ type: 'display' }));
    const disp = await dispPromise;

    const target = disp.warps[0];
    const movePromise = waitForMsg(ws, 'playerMoved');
    ws.send(JSON.stringify({ type: 'move', sector: target }));
    const moveMsg = await movePromise;

    assert.equal(moveMsg.type, 'playerMoved');
    assert.equal(moveMsg.sector, target);
    await closeWS(ws);
  });

  await test('move to non-adjacent sector returns nonAdjacentMoveRequested', async () => {
    assert.ok(serverReady, 'Server not running');
    const { ws } = await connectWS();

    // Get current warps to find a sector NOT in the list
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

  await test('who returns playersOnline with connected player IDs', async () => {
    assert.ok(serverReady, 'Server not running');
    const { ws } = await connectWS();

    const promise = waitForMsg(ws, 'playersOnline');
    ws.send(JSON.stringify({ type: 'who' }));
    const msg = await promise;

    assert.equal(msg.type, 'playersOnline');
    assert.ok(Array.isArray(msg.players), 'players should be an array');
    assert.ok(msg.players.length >= 1, 'should list at least the current player');
    await closeWS(ws);
  });

  await test('playerLeft broadcast on disconnect', async () => {
    assert.ok(serverReady, 'Server not running');
    const { ws: ws1 } = await connectWS();
    const { ws: ws2, welcome: w2 } = await connectWS();

    const leftPromise = waitForMsg(ws1, 'playerLeft');
    ws2.close();
    const msg = await leftPromise;

    assert.equal(msg.type, 'playerLeft');
    assert.ok(msg.playerId !== undefined, 'playerLeft should include playerId');
    await closeWS(ws1);
  });

  // Cleanup and report
  if (pool) { 
    try { 
      await pool.end();
    } catch (_) { /* ignore */ }
  }

  if (serverProc) { serverProc.kill(); }

  report();
}

runAll().catch((e) => {
  console.error('test runner error:', e);
  report();
});

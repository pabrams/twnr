import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  adminKeyPost, adminKeyGet,
} from './admin-helpers.mjs';
import { ensureServer, createPool as _gsCreatePool } from './global-setup.mjs';

let pool;

before(async () => {
  await ensureServer();
  pool = _gsCreatePool();
});

after(async () => {
  if (pool) await pool.end();
});

describe('Admin API - Topology', () => {
  let universeId;

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'TopoUniverse', sectors: 30, seed: 9999, twoWayPct: 90,
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;
  });

  it('returns correct topology analysis', async () => {
    const res = await adminKeyGet(`/api/admin/universes/${universeId}/topology`);
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);

    // Check all required fields exist and have correct types
    assert.equal(res.body.totalSectors, 30);
    assert.equal(typeof res.body.totalWarps, 'number');
    assert.ok(res.body.totalWarps > 0);
    assert.equal(typeof res.body.bidirectionalPairs, 'number');
    assert.ok(res.body.bidirectionalPairs >= 0);
    assert.equal(typeof res.body.averageOutDegree, 'number');
    assert.ok(res.body.averageOutDegree >= 1 && res.body.averageOutDegree <= 6);
    assert.ok(Array.isArray(res.body.deadEndSectors));
    assert.equal(typeof res.body.isConnected, 'boolean');
  });

  it('bidirectionalPairs counts each pair once', async () => {
    const res = await adminKeyGet(`/api/admin/universes/${universeId}/topology`);
    assert.equal(res.status, 200);

    // Verify against actual DB data
    const warps = await pool.query(
      'SELECT s_from.sector_number as sector_from, s_to.sector_number as sector_to FROM warps w JOIN sectors s_from ON w.from_sector_id = s_from.id JOIN sectors s_to ON w.to_sector_id = s_to.id WHERE s_from.universe_id = $1', [universeId]
    );
    const warpSet = new Set(warps.rows.map(w => `${w.sector_from},${w.sector_to}`));
    let biPairs = 0;
    const counted = new Set();
    for (const w of warps.rows) {
      const key = `${Math.min(w.sector_from, w.sector_to)},${Math.max(w.sector_from, w.sector_to)}`;
      if (!counted.has(key) && warpSet.has(`${w.sector_to},${w.sector_from}`)) {
        biPairs++;
        counted.add(key);
      }
    }
    assert.equal(res.body.bidirectionalPairs, biPairs,
      `Expected ${biPairs} bidirectional pairs, got ${res.body.bidirectionalPairs}`);
  });

  it('averageOutDegree and deadEndSectors match actual DB data', async () => {
    const res = await adminKeyGet(`/api/admin/universes/${universeId}/topology`);
    assert.equal(res.status, 200);

    // Compute expected values from DB
    const warps = await pool.query(
      'SELECT s_from.sector_number as sector_from, s_to.sector_number as sector_to FROM warps w JOIN sectors s_from ON w.from_sector_id = s_from.id JOIN sectors s_to ON w.to_sector_id = s_to.id WHERE s_from.universe_id = $1', [universeId]
    );
    const outDeg = new Map();
    for (let i = 1; i <= 30; i++) outDeg.set(i, 0);
    for (const w of warps.rows) {
      outDeg.set(w.sector_from, (outDeg.get(w.sector_from) || 0) + 1);
    }

    const expectedAvg = Math.round((warps.rows.length / 30) * 100) / 100;
    assert.equal(res.body.averageOutDegree, expectedAvg,
      `Expected averageOutDegree ${expectedAvg}, got ${res.body.averageOutDegree}`);

    const expectedDeadEnds = [];
    for (const [sector, deg] of outDeg) {
      if (deg === 1) expectedDeadEnds.push(sector);
    }
    expectedDeadEnds.sort((a, b) => a - b);
    assert.deepStrictEqual(res.body.deadEndSectors, expectedDeadEnds,
      `deadEndSectors mismatch`);
  });

  it('averageOutDegree is rounded to 2 decimal places', async () => {
    const res = await adminKeyGet(`/api/admin/universes/${universeId}/topology`);
    assert.equal(res.status, 200);
    const str = String(res.body.averageOutDegree);
    const decimals = str.includes('.') ? str.split('.')[1].length : 0;
    assert.ok(decimals <= 2, `averageOutDegree should have at most 2 decimal places, got ${str}`);
  });

  it('isConnected is true for a generated universe', async () => {
    const res = await adminKeyGet(`/api/admin/universes/${universeId}/topology`);
    assert.equal(res.status, 200);
    assert.equal(res.body.isConnected, true, 'Generated universe should be connected');
  });

  it('returns 404 for non-existent universe', async () => {
    const res = await adminKeyGet('/api/admin/universes/99999/topology');
    assert.equal(res.status, 404);
    assert.ok(res.body.error.toLowerCase().includes('not found'));
  });
});

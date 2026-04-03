import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAdminUser, isConnected,
  adminPost, adminKeyPost, adminKeyGet,
  setupAdminTests, teardownAdminTests,
} from './admin-helpers.mjs';

let pool;
let serverProc;

before(async () => {
  ({ pool, serverProc } = await setupAdminTests());
});

after(async () => {
  await teardownAdminTests(pool, serverProc);
});

describe('Admin API - Generate Universe', () => {
  it('creates a universe with valid parameters', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'TestUniverse',
      sectors: 30,
      seed: 12345,
    });
    assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.name, 'TestUniverse');
    assert.equal(res.body.seed, 12345);
    assert.equal(res.body.sectorCount, 30);
    assert.ok(res.body.id > 0, 'Should return a universe id');
    assert.ok(res.body.warpCount > 0, 'Should have warps');
    assert.ok(res.body.portCount > 0, 'Should have ports');
  });

  it('uses default portDensity and twoWayPct when omitted', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'DefaultsTest', sectors: 40, seed: 77777,
    });
    assert.equal(res.status, 201);
    const uid = res.body.id;

    // Default portDensity=50: expect ~50% of sectors to have trading ports
    const portRes = await pool.query(
      'SELECT COUNT(*) as cnt FROM ports WHERE universe_id = $1 AND class BETWEEN 1 AND 8', [uid]
    );
    const tradingPorts = parseInt(portRes.rows[0].cnt, 10);
    assert.ok(tradingPorts >= 15 && tradingPorts <= 25,
      `Expected ~19 trading ports with default 50% density on 40 sectors, got ${tradingPorts}`);

    // Default twoWayPct=90: expect ~90% bidirectional warps
    const warpRes = await pool.query(
      'SELECT sector_from, sector_to FROM warps WHERE universe_id = $1', [uid]
    );
    const warpSet = new Set(warpRes.rows.map(w => `${w.sector_from},${w.sector_to}`));
    let biCount = 0;
    const counted = new Set();
    for (const w of warpRes.rows) {
      const key = `${Math.min(w.sector_from, w.sector_to)},${Math.max(w.sector_from, w.sector_to)}`;
      if (!counted.has(key) && warpSet.has(`${w.sector_to},${w.sector_from}`)) {
        biCount++;
        counted.add(key);
      }
    }
    const biPct = (biCount * 2 / warpRes.rows.length) * 100;
    assert.ok(biPct >= 75 && biPct <= 100,
      `Expected ~90% bidirectional warps with default, got ${biPct.toFixed(1)}%`);
  });

  it('returns 400 when name is missing', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', { sectors: 30 });
    assert.equal(res.status, 400);
    assert.ok(res.body.error, 'Should have error message');
  });

  it('returns 400 when name is empty string', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', { name: '', sectors: 30 });
    assert.equal(res.status, 400);
  });

  it('returns 400 when sectors is below 20', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', { name: 'Small', sectors: 5 });
    assert.equal(res.status, 400);
  });

  it('returns 400 when sectors is above 500', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', { name: 'Huge', sectors: 1000 });
    assert.equal(res.status, 400);
  });

  it('returns 400 when sectors is missing', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', { name: 'NoSectors' });
    assert.equal(res.status, 400);
  });

  it('generates a random seed when not provided', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', { name: 'NoSeed', sectors: 20 });
    assert.equal(res.status, 201);
    assert.ok(typeof res.body.seed === 'number', 'Should return a numeric seed');
  });

  it('produces deterministic output with the same seed', async () => {
    const params = { name: 'Deterministic', sectors: 25, seed: 99999, portDensity: 50, twoWayPct: 90 };
    const res1 = await adminKeyPost('/api/admin/universes/generate', params);
    const res2 = await adminKeyPost('/api/admin/universes/generate', { ...params, name: 'Deterministic2' });
    assert.equal(res1.status, 201);
    assert.equal(res2.status, 201);
    assert.equal(res1.body.sectorCount, res2.body.sectorCount);
    assert.equal(res1.body.warpCount, res2.body.warpCount);
    assert.equal(res1.body.portCount, res2.body.portCount);

    // Verify actual data matches
    const stats1 = await adminKeyGet(`/api/admin/universes/${res1.body.id}/stats`);
    const stats2 = await adminKeyGet(`/api/admin/universes/${res2.body.id}/stats`);
    assert.equal(stats1.body.warpCount, stats2.body.warpCount);
    assert.equal(stats1.body.portCount, stats2.body.portCount);
  });

  it('creates Federation Space at sector 1 with Class 0 port', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', { name: 'FedTest', sectors: 20, seed: 42 });
    assert.equal(res.status, 201);
    const uid = res.body.id;

    // Check sector 1 is Federation Space
    const sectorRes = await pool.query(
      'SELECT name FROM sectors WHERE id = 1 AND universe_id = $1', [uid]
    );
    assert.equal(sectorRes.rows.length, 1);
    assert.equal(sectorRes.rows[0].name, 'Federation Space');

    // Check Class 0 port at sector 1
    const portRes = await pool.query(
      'SELECT class, fuel, fuel_price, organics, org_price, equipment, equ_price FROM ports WHERE sector_id = 1 AND universe_id = $1', [uid]
    );
    assert.equal(portRes.rows.length, 1);
    assert.equal(portRes.rows[0].class, 0);
    assert.equal(portRes.rows[0].fuel, 0);
    assert.equal(portRes.rows[0].fuel_price, 0);
    assert.equal(portRes.rows[0].organics, 0);
    assert.equal(portRes.rows[0].org_price, 0);
    assert.equal(portRes.rows[0].equipment, 0);
    assert.equal(portRes.rows[0].equ_price, 0);
  });

  it('creates a Stardock sector with Class 9 port', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', { name: 'StardockTest', sectors: 20, seed: 42 });
    assert.equal(res.status, 201);
    const uid = res.body.id;

    // Check Stardock exists
    const sectorRes = await pool.query(
      'SELECT id FROM sectors WHERE name = $1 AND universe_id = $2', ['Stardock', uid]
    );
    assert.equal(sectorRes.rows.length, 1, 'Should have exactly one Stardock sector');
    const stardockId = sectorRes.rows[0].id;
    assert.ok(stardockId >= 2, 'Stardock should not be sector 1');

    // Check Class 9 port at Stardock with all quantities and prices 0
    const portRes = await pool.query(
      'SELECT class, fuel, fuel_price, organics, org_price, equipment, equ_price FROM ports WHERE sector_id = $1 AND universe_id = $2', [stardockId, uid]
    );
    assert.equal(portRes.rows.length, 1);
    assert.equal(portRes.rows[0].class, 9);
    assert.equal(portRes.rows[0].fuel, 0);
    assert.equal(portRes.rows[0].fuel_price, 0);
    assert.equal(portRes.rows[0].organics, 0);
    assert.equal(portRes.rows[0].org_price, 0);
    assert.equal(portRes.rows[0].equipment, 0);
    assert.equal(portRes.rows[0].equ_price, 0);
  });

  it('generates a connected warp graph', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', { name: 'ConnTest', sectors: 30, seed: 777 });
    assert.equal(res.status, 201);
    const uid = res.body.id;

    const warpRes = await pool.query(
      'SELECT sector_from, sector_to FROM warps WHERE universe_id = $1', [uid]
    );
    assert.ok(isConnected(30, warpRes.rows), 'All sectors must be reachable from sector 1');
  });

  it('respects degree constraints (1-6 in/out per sector)', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', { name: 'DegreeTest', sectors: 30, seed: 888 });
    assert.equal(res.status, 201);
    const uid = res.body.id;

    const warpRes = await pool.query(
      'SELECT sector_from, sector_to FROM warps WHERE universe_id = $1', [uid]
    );

    const outDeg = new Map();
    const inDeg = new Map();
    for (let i = 1; i <= 30; i++) { outDeg.set(i, 0); inDeg.set(i, 0); }
    for (const w of warpRes.rows) {
      outDeg.set(w.sector_from, (outDeg.get(w.sector_from) || 0) + 1);
      inDeg.set(w.sector_to, (inDeg.get(w.sector_to) || 0) + 1);
    }
    for (let i = 1; i <= 30; i++) {
      const out = outDeg.get(i);
      const inp = inDeg.get(i);
      assert.ok(out >= 1 && out <= 6, `Sector ${i} has out-degree ${out}, expected 1-6`);
      assert.ok(inp >= 1 && inp <= 6, `Sector ${i} has in-degree ${inp}, expected 1-6`);
    }
  });

  it('respects port density parameter', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'DensityTest', sectors: 40, seed: 555, portDensity: 50,
    });
    assert.equal(res.status, 201);
    const uid = res.body.id;

    // Count trading ports (class 1-8), excluding class 0 and class 9
    const portRes = await pool.query(
      'SELECT COUNT(*) as cnt FROM ports WHERE universe_id = $1 AND class BETWEEN 1 AND 8', [uid]
    );
    const tradingPorts = parseInt(portRes.rows[0].cnt, 10);
    // With 50% density on 40 sectors, expect ~20 trading ports (minus stardock which gets class 9)
    const expected = Math.round(40 * 50 / 100) - 1;
    assert.ok(tradingPorts >= expected - 3 && tradingPorts <= expected + 3,
      `Expected ~${expected} trading ports with 50% density, got ${tradingPorts}`);
  });

  it('respects twoWayPct parameter', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'TwoWayTest', sectors: 30, seed: 444, twoWayPct: 90,
    });
    assert.equal(res.status, 201);
    const uid = res.body.id;

    const warpRes = await pool.query(
      'SELECT sector_from, sector_to FROM warps WHERE universe_id = $1', [uid]
    );
    const warpSet = new Set(warpRes.rows.map(w => `${w.sector_from},${w.sector_to}`));
    let biCount = 0;
    const counted = new Set();
    for (const w of warpRes.rows) {
      const key = `${Math.min(w.sector_from, w.sector_to)},${Math.max(w.sector_from, w.sector_to)}`;
      if (!counted.has(key) && warpSet.has(`${w.sector_to},${w.sector_from}`)) {
        biCount++;
        counted.add(key);
      }
    }
    // bidirectional warps = biCount * 2 out of total
    const biPct = (biCount * 2 / warpRes.rows.length) * 100;
    assert.ok(biPct >= 75 && biPct <= 100,
      `Expected ~90% bidirectional warps, got ${biPct.toFixed(1)}%`);
  });

  it('trading ports have valid commodity quantities and prices', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'PriceTest', sectors: 30, seed: 333,
    });
    assert.equal(res.status, 201);
    const uid = res.body.id;

    const portRes = await pool.query(
      'SELECT * FROM ports WHERE universe_id = $1 AND class BETWEEN 1 AND 8', [uid]
    );
    assert.ok(portRes.rows.length > 0, 'Should have trading ports');

    const CLASS_ACTIONS = {
      1: ['B', 'B', 'S'], 2: ['B', 'S', 'B'], 3: ['S', 'B', 'B'], 4: ['S', 'S', 'B'],
      5: ['B', 'S', 'S'], 6: ['S', 'B', 'S'], 7: ['S', 'S', 'S'], 8: ['B', 'B', 'B'],
    };
    for (const port of portRes.rows) {
      // Quantities 0-5000
      assert.ok(port.fuel >= 0 && port.fuel <= 5000, `Fuel qty ${port.fuel} out of range`);
      assert.ok(port.organics >= 0 && port.organics <= 5000, `Org qty ${port.organics} out of range`);
      assert.ok(port.equipment >= 0 && port.equipment <= 5000, `Equ qty ${port.equipment} out of range`);
      // Prices must match buy/sell tier for the port's class
      const actions = CLASS_ACTIONS[port.class];
      const commodities = [
        { name: 'fuel', action: actions[0], price: port.fuel_price },
        { name: 'organics', action: actions[1], price: port.org_price },
        { name: 'equipment', action: actions[2], price: port.equ_price },
      ];
      for (const c of commodities) {
        if (c.action === 'S') {
          assert.ok(c.price >= 10 && c.price <= 50,
            `Class ${port.class} sector ${port.sector_id}: ${c.name} is Sell, price ${c.price} should be 10-50`);
        } else {
          assert.ok(c.price >= 51 && c.price <= 100,
            `Class ${port.class} sector ${port.sector_id}: ${c.name} is Buy, price ${c.price} should be 51-100`);
        }
      }
    }
  });

  it('accepts admin API key authentication', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'ApiKeyTest', sectors: 20, seed: 111,
    });
    assert.equal(res.status, 201);
  });

  it('accepts admin JWT authentication', async () => {
    const { token } = await createAdminUser(pool);
    const res = await adminPost('/api/admin/universes/generate', {
      name: 'JwtTest', sectors: 20, seed: 222,
    }, token);
    assert.equal(res.status, 201);
  });
});

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAdminUser, isConnected,
  adminPost, adminKeyPost, adminKeyGet,
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

    // Default portDensity=80: target 32 ports on 40 sectors, minus 1 starbase (class 9) = ~31 trading ports (class 1-8)
    const portRes = await pool.query(
      'SELECT COUNT(*) as cnt FROM ports p JOIN sectors s ON p.sector_id = s.id WHERE s.universe_id = $1 AND p.class BETWEEN 1 AND 8', [uid]
    );
    const tradingPorts = parseInt(portRes.rows[0].cnt, 10);
    assert.ok(tradingPorts >= 27 && tradingPorts <= 35,
      `Expected ~31 trading ports with default 80% density on 40 sectors, got ${tradingPorts}`);

    // Default twoWayPct=95: expect ~95% bidirectional warps
    const warpRes = await pool.query(
      'SELECT s_from.sector_number as sector_from, s_to.sector_number as sector_to FROM warps w JOIN sectors s_from ON w.from_sector_id = s_from.id JOIN sectors s_to ON w.to_sector_id = s_to.id WHERE s_from.universe_id = $1', [uid]
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
    assert.ok(biPct >= 85 && biPct <= 100,
      `Expected ~95% bidirectional warps with default, got ${biPct.toFixed(1)}%`);
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

  it('returns 400 when sectors is above 25000', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', { name: 'Huge', sectors: 30000 });
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
      'SELECT name FROM sectors WHERE sector_number = 1 AND universe_id = $1', [uid]
    );
    assert.equal(sectorRes.rows.length, 1);
    assert.equal(sectorRes.rows[0].name, 'Federation Space');

    // Check Class 0 port at sector 1 — special ports carry zeroed quantities,
    // productivity, and MCIC. Static price columns no longer exist.
    const portRes = await pool.query(
      `SELECT p.class, p.fuel, p.fuel_max, p.fuel_prod, p.fuel_mcic,
              p.organics, p.org_max, p.org_prod, p.org_mcic,
              p.equipment, p.equ_max, p.equ_prod, p.equ_mcic
       FROM ports p JOIN sectors s ON p.sector_id = s.id
       WHERE s.sector_number = 1 AND s.universe_id = $1`, [uid]
    );
    assert.equal(portRes.rows.length, 1);
    const r = portRes.rows[0];
    assert.equal(r.class, 0);
    for (const k of ['fuel', 'fuel_max', 'fuel_prod', 'fuel_mcic',
                     'organics', 'org_max', 'org_prod', 'org_mcic',
                     'equipment', 'equ_max', 'equ_prod', 'equ_mcic']) {
      assert.equal(r[k], 0, `class-0 ${k} should be 0`);
    }
  });

  it('creates a Starbase sector with Class 9 port', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', { name: 'StarbaseTest', sectors: 20, seed: 42 });
    assert.equal(res.status, 201);
    const uid = res.body.id;

    // Check Starbase exists
    const sectorRes = await pool.query(
      'SELECT id, sector_number FROM sectors WHERE name = $1 AND universe_id = $2', ['Starbase', uid]
    );
    assert.equal(sectorRes.rows.length, 1, 'Should have exactly one Starbase sector');
    const starbaseSectorNumber = sectorRes.rows[0].sector_number;
    const starbaseId = sectorRes.rows[0].id;
    assert.ok(starbaseSectorNumber >= 2, 'Starbase should not be sector 1');

    // Check Class 9 port at Starbase with all quantities zeroed (no static
    // prices — class 9 has no trade flow anyway).
    const portRes = await pool.query(
      `SELECT p.class, p.fuel, p.fuel_max, p.fuel_prod, p.fuel_mcic,
              p.organics, p.org_max, p.org_prod, p.org_mcic,
              p.equipment, p.equ_max, p.equ_prod, p.equ_mcic
       FROM ports p WHERE p.sector_id = $1`, [starbaseId]
    );
    assert.equal(portRes.rows.length, 1);
    const r = portRes.rows[0];
    assert.equal(r.class, 9);
    for (const k of ['fuel', 'fuel_max', 'fuel_prod', 'fuel_mcic',
                     'organics', 'org_max', 'org_prod', 'org_mcic',
                     'equipment', 'equ_max', 'equ_prod', 'equ_mcic']) {
      assert.equal(r[k], 0, `class-9 ${k} should be 0`);
    }
  });

  it('generates a connected warp graph', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', { name: 'ConnTest', sectors: 30, seed: 777 });
    assert.equal(res.status, 201);
    const uid = res.body.id;

    const warpRes = await pool.query(
      'SELECT s_from.sector_number as sector_from, s_to.sector_number as sector_to FROM warps w JOIN sectors s_from ON w.from_sector_id = s_from.id JOIN sectors s_to ON w.to_sector_id = s_to.id WHERE s_from.universe_id = $1', [uid]
    );
    assert.ok(isConnected(30, warpRes.rows), 'All sectors must be reachable from sector 1');
  });

  it('respects degree constraints (1-6 in/out per sector)', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', { name: 'DegreeTest', sectors: 30, seed: 888 });
    assert.equal(res.status, 201);
    const uid = res.body.id;

    const warpRes = await pool.query(
      'SELECT s_from.sector_number as sector_from, s_to.sector_number as sector_to FROM warps w JOIN sectors s_from ON w.from_sector_id = s_from.id JOIN sectors s_to ON w.to_sector_id = s_to.id WHERE s_from.universe_id = $1', [uid]
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
      'SELECT COUNT(*) as cnt FROM ports p JOIN sectors s ON p.sector_id = s.id WHERE s.universe_id = $1 AND p.class BETWEEN 1 AND 8', [uid]
    );
    const tradingPorts = parseInt(portRes.rows[0].cnt, 10);
    // With 50% density on 40 sectors, expect ~20 trading ports (minus starbase which gets class 9)
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
      'SELECT s_from.sector_number as sector_from, s_to.sector_number as sector_to FROM warps w JOIN sectors s_from ON w.from_sector_id = s_from.id JOIN sectors s_to ON w.to_sector_id = s_to.id WHERE s_from.universe_id = $1', [uid]
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

  it('trading ports spawn with productivity, MCIC, and stock matching action direction', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'PriceTest', sectors: 30, seed: 333,
    });
    assert.equal(res.status, 201);
    const uid = res.body.id;

    const portRes = await pool.query(
      'SELECT p.* FROM ports p JOIN sectors s ON p.sector_id = s.id WHERE s.universe_id = $1 AND p.class BETWEEN 1 AND 8', [uid]
    );
    assert.ok(portRes.rows.length > 0, 'Should have trading ports');

    const CLASS_ACTIONS = {
      1: ['B', 'B', 'S'], 2: ['B', 'S', 'B'], 3: ['S', 'B', 'B'], 4: ['S', 'S', 'B'],
      5: ['B', 'S', 'S'], 6: ['S', 'B', 'S'], 7: ['S', 'S', 'S'], 8: ['B', 'B', 'B'],
    };
    const MCIC_RANGE = { fuel: [40, 90], organics: [30, 75], equipment: [20, 65] };
    for (const port of portRes.rows) {
      const actions = CLASS_ACTIONS[port.class];
      const commodities = [
        { name: 'fuel', action: actions[0], qty: port.fuel, max: port.fuel_max, prod: port.fuel_prod, mcic: port.fuel_mcic },
        { name: 'organics', action: actions[1], qty: port.organics, max: port.org_max, prod: port.org_prod, mcic: port.org_mcic },
        { name: 'equipment', action: actions[2], qty: port.equipment, max: port.equ_max, prod: port.equ_prod, mcic: port.equ_mcic },
      ];
      for (const c of commodities) {
        // Productivity 60-280 (max ∈ [600, 2800]) to match observed legacy starting amounts
        assert.ok(c.prod >= 60 && c.prod <= 280, `Class ${port.class} ${c.name}: prod ${c.prod} out of [60,280]`);
        assert.equal(c.max, c.prod * 10, `Class ${port.class} ${c.name}: max ${c.max} != prod*10`);
        // Physical-stock spawn: selling ports start full, buying ports start empty
        if (c.action === 'S') {
          assert.equal(c.qty, c.max, `Class ${port.class} ${c.name} (S): should spawn full, got ${c.qty}/${c.max}`);
        } else {
          assert.equal(c.qty, 0, `Class ${port.class} ${c.name} (B): should spawn empty, got ${c.qty}`);
        }
        // MCIC magnitude in commodity range and sign matches class action
        const range = MCIC_RANGE[c.name];
        const mag = Math.abs(c.mcic);
        assert.ok(mag >= range[0] && mag <= range[1],
          `Class ${port.class} ${c.name}: |MCIC| ${mag} not in [${range[0]},${range[1]}]`);
        if (c.action === 'S') {
          assert.ok(c.mcic > 0, `Class ${port.class} ${c.name}: S-action MCIC must be positive, got ${c.mcic}`);
        } else {
          assert.ok(c.mcic < 0, `Class ${port.class} ${c.name}: B-action MCIC must be negative, got ${c.mcic}`);
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

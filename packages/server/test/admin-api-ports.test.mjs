import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  adminKeyPost, adminKeyGet, adminKeyPut, adminKeyDelete,
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

describe('Admin API - List Ports', () => {
  let universeId;

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'PortListUniverse', sectors: 20, seed: 11111,
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;
  });

  it('returns all ports sorted by sectorId', async () => {
    const res = await adminKeyGet(`/api/admin/universes/${universeId}/ports`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body), 'Should return an array');
    assert.ok(res.body.length > 0, 'Should have ports');

    // Check sorted by sectorId
    for (let i = 1; i < res.body.length; i++) {
      assert.ok(res.body[i].sectorId > res.body[i - 1].sectorId,
        `Ports not sorted: sector ${res.body[i - 1].sectorId} before ${res.body[i].sectorId}`);
    }

    // Check port object shape
    const port = res.body[0];
    assert.ok('sectorId' in port, 'Should have sectorId');
    assert.ok('class' in port, 'Should have class');
    assert.ok('fuel' in port, 'Should have fuel');
    assert.ok('fuelPrice' in port, 'Should have fuelPrice');
    assert.ok('organics' in port, 'Should have organics');
    assert.ok('orgPrice' in port, 'Should have orgPrice');
    assert.ok('equipment' in port, 'Should have equipment');
    assert.ok('equPrice' in port, 'Should have equPrice');
  });

  it('includes Class 0 and Class 9 special ports', async () => {
    const res = await adminKeyGet(`/api/admin/universes/${universeId}/ports`);
    assert.equal(res.status, 200);
    const classes = res.body.map(p => p.class);
    assert.ok(classes.includes(0), 'Should include Class 0 port');
    assert.ok(classes.includes(9), 'Should include Class 9 port');
  });

  it('returns 404 for non-existent universe', async () => {
    const res = await adminKeyGet('/api/admin/universes/99999/ports');
    assert.equal(res.status, 404);
  });
});

describe('Admin API - Update Port', () => {
  let universeId;
  let tradingPortSector;

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'PortEditUniverse', sectors: 20, seed: 22222,
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;

    // Find a trading port (class 1-8)
    const ports = await pool.query(
      'SELECT sector_id, class FROM ports WHERE universe_id = $1 AND class BETWEEN 1 AND 8 LIMIT 1',
      [universeId],
    );
    assert.ok(ports.rows.length > 0, 'Should have at least one trading port');
    tradingPortSector = ports.rows[0].sector_id;
  });

  it('updates a port quantity', async () => {
    const res = await adminKeyPut(
      `/api/admin/universes/${universeId}/ports/${tradingPortSector}`,
      { fuel: 2500 },
    );
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.fuel, 2500);
    assert.equal(res.body.sectorId, tradingPortSector);
  });

  it('updates a port class with valid prices', async () => {
    // Class 3: Sell fuel, Buy organics, Buy equipment
    // Sell prices: 10-50, Buy prices: 51-100
    const res = await adminKeyPut(
      `/api/admin/universes/${universeId}/ports/${tradingPortSector}`,
      { class: 3, fuelPrice: 25, orgPrice: 75, equPrice: 80, fuel: 1000, organics: 2000, equipment: 3000 },
    );
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.class, 3);
    assert.equal(res.body.fuelPrice, 25);
    assert.equal(res.body.orgPrice, 75);
  });

  it('rejects price that violates buy/sell rules for class', async () => {
    // Class 1: Buy fuel (51-100), Buy organics (51-100), Sell equipment (10-50)
    // Setting fuelPrice to 25 violates Buy range
    const res = await adminKeyPut(
      `/api/admin/universes/${universeId}/ports/${tradingPortSector}`,
      { class: 1, fuelPrice: 25, orgPrice: 75, equPrice: 30 },
    );
    assert.equal(res.status, 400, `Expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.error, 'Should have error message');
  });

  it('rejects class change when existing prices become invalid', async () => {
    // First set port to class 3 with valid prices: Sell fuel (25), Buy org (75), Buy equ (80)
    await adminKeyPut(
      `/api/admin/universes/${universeId}/ports/${tradingPortSector}`,
      { class: 3, fuelPrice: 25, orgPrice: 75, equPrice: 80 },
    );
    // Now change to class 1: Buy fuel (51-100), Buy org (51-100), Sell equ (10-50)
    // fuelPrice=25 is invalid for Buy, equPrice=80 is invalid for Sell
    const res = await adminKeyPut(
      `/api/admin/universes/${universeId}/ports/${tradingPortSector}`,
      { class: 1 },
    );
    assert.equal(res.status, 400, `Expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  it('rejects invalid class value', async () => {
    const res = await adminKeyPut(
      `/api/admin/universes/${universeId}/ports/${tradingPortSector}`,
      { class: 99 },
    );
    assert.equal(res.status, 400);
  });

  it('rejects quantity out of range', async () => {
    const res = await adminKeyPut(
      `/api/admin/universes/${universeId}/ports/${tradingPortSector}`,
      { fuel: 9999 },
    );
    assert.equal(res.status, 400);
  });

  it('rejects modification of Class 0 port', async () => {
    const res = await adminKeyPut(
      `/api/admin/universes/${universeId}/ports/1`,
      { fuel: 100 },
    );
    assert.equal(res.status, 403);
    assert.ok(res.body.error.toLowerCase().includes('special'));
  });

  it('rejects modification of Class 9 port', async () => {
    const stardock = await pool.query(
      "SELECT sector_id FROM ports WHERE universe_id = $1 AND class = 9", [universeId]
    );
    assert.ok(stardock.rows.length > 0);
    const res = await adminKeyPut(
      `/api/admin/universes/${universeId}/ports/${stardock.rows[0].sector_id}`,
      { fuel: 100 },
    );
    assert.equal(res.status, 403);
  });

  it('returns 404 for non-existent port', async () => {
    const res = await adminKeyPut(
      `/api/admin/universes/${universeId}/ports/99999`,
      { fuel: 100 },
    );
    assert.equal(res.status, 404);
  });

  it('returns 404 for non-existent universe', async () => {
    const res = await adminKeyPut('/api/admin/universes/99999/ports/1', { fuel: 100 });
    assert.equal(res.status, 404);
  });
});

describe('Admin API - Create Port', () => {
  let universeId;
  let emptySector;

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'PortCreateUniverse', sectors: 30, seed: 33333, portDensity: 20,
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;

    // Find a sector without a port
    const result = await pool.query(
      `SELECT s.id FROM sectors s LEFT JOIN ports p ON p.sector_id = s.id AND p.universe_id = s.universe_id
       WHERE s.universe_id = $1 AND p.id IS NULL AND s.id > 1
       ORDER BY s.id LIMIT 1`,
      [universeId],
    );
    assert.ok(result.rows.length > 0, 'Should have a sector without a port');
    emptySector = result.rows[0].id;
  });

  it('creates a port with valid data', async () => {
    // Class 2: Buy fuel (51-100), Sell organics (10-50), Buy equipment (51-100)
    const res = await adminKeyPost(
      `/api/admin/universes/${universeId}/ports/${emptySector}`,
      { class: 2, fuel: 1000, fuelPrice: 75, organics: 2000, orgPrice: 30, equipment: 500, equPrice: 90 },
    );
    assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.sectorId, emptySector);
    assert.equal(res.body.class, 2);
    assert.equal(res.body.fuel, 1000);
    assert.equal(res.body.fuelPrice, 75);
  });

  it('rejects invalid price for port class', async () => {
    // Find another empty sector
    const result = await pool.query(
      `SELECT s.id FROM sectors s LEFT JOIN ports p ON p.sector_id = s.id AND p.universe_id = s.universe_id
       WHERE s.universe_id = $1 AND p.id IS NULL AND s.id > 1
       ORDER BY s.id LIMIT 1`,
      [universeId],
    );
    assert.ok(result.rows.length > 0);
    const sector = result.rows[0].id;

    // Class 5: Buy fuel (51-100), Sell organics (10-50), Sell equipment (10-50)
    // Setting fuelPrice to 30 violates Buy range
    const res = await adminKeyPost(
      `/api/admin/universes/${universeId}/ports/${sector}`,
      { class: 5, fuel: 100, fuelPrice: 30, organics: 100, orgPrice: 20, equipment: 100, equPrice: 20 },
    );
    assert.equal(res.status, 400);
    assert.ok(res.body.error, 'Should have error about price');
  });

  it('rejects class 0 or class 9 creation', async () => {
    const result = await pool.query(
      `SELECT s.id FROM sectors s LEFT JOIN ports p ON p.sector_id = s.id AND p.universe_id = s.universe_id
       WHERE s.universe_id = $1 AND p.id IS NULL AND s.id > 1
       ORDER BY s.id LIMIT 1`,
      [universeId],
    );
    const sector = result.rows[0].id;

    const res0 = await adminKeyPost(
      `/api/admin/universes/${universeId}/ports/${sector}`,
      { class: 0, fuel: 0, fuelPrice: 0, organics: 0, orgPrice: 0, equipment: 0, equPrice: 0 },
    );
    assert.equal(res0.status, 400);

    const res9 = await adminKeyPost(
      `/api/admin/universes/${universeId}/ports/${sector}`,
      { class: 9, fuel: 0, fuelPrice: 0, organics: 0, orgPrice: 0, equipment: 0, equPrice: 0 },
    );
    assert.equal(res9.status, 400);
  });

  it('rejects missing required fields', async () => {
    const result = await pool.query(
      `SELECT s.id FROM sectors s LEFT JOIN ports p ON p.sector_id = s.id AND p.universe_id = s.universe_id
       WHERE s.universe_id = $1 AND p.id IS NULL AND s.id > 1
       ORDER BY s.id LIMIT 1`,
      [universeId],
    );
    assert.ok(result.rows.length > 0);
    const sector = result.rows[0].id;

    // Missing fuelPrice
    const res = await adminKeyPost(
      `/api/admin/universes/${universeId}/ports/${sector}`,
      { class: 1, fuel: 100, organics: 100, orgPrice: 80, equipment: 100, equPrice: 30 },
    );
    assert.equal(res.status, 400);
  });

  it('rejects duplicate port (409)', async () => {
    // emptySector already has a port from the first test
    const res = await adminKeyPost(
      `/api/admin/universes/${universeId}/ports/${emptySector}`,
      { class: 1, fuel: 100, fuelPrice: 75, organics: 100, orgPrice: 80, equipment: 100, equPrice: 30 },
    );
    assert.equal(res.status, 409);
  });

  it('rejects quantity out of range on create', async () => {
    const result = await pool.query(
      `SELECT s.id FROM sectors s LEFT JOIN ports p ON p.sector_id = s.id AND p.universe_id = s.universe_id
       WHERE s.universe_id = $1 AND p.id IS NULL AND s.id > 1
       ORDER BY s.id LIMIT 1`,
      [universeId],
    );
    assert.ok(result.rows.length > 0);
    const sector = result.rows[0].id;

    const res = await adminKeyPost(
      `/api/admin/universes/${universeId}/ports/${sector}`,
      { class: 1, fuel: 9999, fuelPrice: 75, organics: 100, orgPrice: 80, equipment: 100, equPrice: 30 },
    );
    assert.equal(res.status, 400);
  });

  it('rejects non-existent sector', async () => {
    const res = await adminKeyPost(
      `/api/admin/universes/${universeId}/ports/99999`,
      { class: 1, fuel: 100, fuelPrice: 75, organics: 100, orgPrice: 80, equipment: 100, equPrice: 30 },
    );
    assert.equal(res.status, 404);
  });

  it('returns 404 for non-existent universe', async () => {
    const res = await adminKeyPost(
      '/api/admin/universes/99999/ports/1',
      { class: 1, fuel: 100, fuelPrice: 75, organics: 100, orgPrice: 80, equipment: 100, equPrice: 30 },
    );
    assert.equal(res.status, 404);
  });
});

describe('Admin API - Delete Port', () => {
  let universeId;
  let tradingPortSector;

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'PortDeleteUniverse', sectors: 20, seed: 44444,
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;

    const ports = await pool.query(
      'SELECT sector_id FROM ports WHERE universe_id = $1 AND class BETWEEN 1 AND 8 LIMIT 1',
      [universeId],
    );
    assert.ok(ports.rows.length > 0);
    tradingPortSector = ports.rows[0].sector_id;
  });

  it('deletes a trading port', async () => {
    const res = await adminKeyDelete(`/api/admin/universes/${universeId}/ports/${tradingPortSector}`);
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.deleted, true);
    assert.equal(res.body.sectorId, tradingPortSector);

    // Verify it's gone
    const check = await pool.query(
      'SELECT COUNT(*) FROM ports WHERE sector_id = $1 AND universe_id = $2',
      [tradingPortSector, universeId],
    );
    assert.equal(parseInt(check.rows[0].count, 10), 0);
  });

  it('rejects deletion of Class 0 port', async () => {
    const res = await adminKeyDelete(`/api/admin/universes/${universeId}/ports/1`);
    assert.equal(res.status, 403);
    assert.ok(res.body.error.toLowerCase().includes('special'));
  });

  it('rejects deletion of Class 9 port', async () => {
    const stardock = await pool.query(
      "SELECT sector_id FROM ports WHERE universe_id = $1 AND class = 9", [universeId]
    );
    assert.ok(stardock.rows.length > 0);
    const res = await adminKeyDelete(
      `/api/admin/universes/${universeId}/ports/${stardock.rows[0].sector_id}`,
    );
    assert.equal(res.status, 403);
  });

  it('returns 404 for non-existent port', async () => {
    const res = await adminKeyDelete(`/api/admin/universes/${universeId}/ports/99999`);
    assert.equal(res.status, 404);
  });

  it('returns 404 for non-existent universe', async () => {
    const res = await adminKeyDelete('/api/admin/universes/99999/ports/1');
    assert.equal(res.status, 404);
  });
});

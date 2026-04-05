import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureServer, createPool } from './global-setup.mjs';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = join(dirname(__filename), '..');
const UNIVERSE_ID = 1;

let pool;

before(async () => {
  await ensureServer();
  pool = createPool();
});

after(async () => {
  if (pool) await pool.end();
});

describe('Universe Generation', () => {
  it('100 sectors exist in the sectors table', async () => {
    const res = await pool.query('SELECT COUNT(*)::int AS count FROM sectors WHERE universe_id = $1', [UNIVERSE_ID]);
    assert.equal(res.rows[0].count, 100, `Expected 100 sectors, got ${res.rows[0].count}`);
  });

  it('every sector has between 1 and 6 warps', async () => {
    const res = await pool.query(
      `SELECT sector_from, COUNT(*)::int AS warp_count
       FROM warps WHERE universe_id = $1 GROUP BY sector_from`, [UNIVERSE_ID]
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
      'SELECT COUNT(*)::int AS count FROM warps WHERE sector_from = sector_to AND universe_id = $1', [UNIVERSE_ID]
    );
    assert.equal(res.rows[0].count, 0, 'Found self-referential warps');
  });

  it('no duplicate warps from the same sector', async () => {
    const res = await pool.query(
      `SELECT sector_from, sector_to, COUNT(*)::int AS cnt
       FROM warps WHERE universe_id = $1 GROUP BY sector_from, sector_to HAVING COUNT(*) > 1`, [UNIVERSE_ID]
    );
    assert.equal(res.rows.length, 0, `Found ${res.rows.length} duplicate warp entries`);
  });

  it('all warp targets reference valid sectors', async () => {
    const res = await pool.query(
      `SELECT wl.sector_to FROM warps wl
       LEFT JOIN sectors s ON wl.sector_to = s.id AND wl.universe_id = s.universe_id
       WHERE s.id IS NULL AND wl.universe_id = $1`, [UNIVERSE_ID]
    );
    assert.equal(res.rows.length, 0, `Found ${res.rows.length} warps pointing to non-existent sectors`);
  });

  it('port inventories are within the valid bigbang range (0-5000)', async () => {
    const res = await pool.query(
      `SELECT MIN(fuel) AS min_f, MAX(fuel) AS max_f,
              MIN(organics) AS min_o, MAX(organics) AS max_o,
              MIN(equipment) AS min_e, MAX(equipment) AS max_e
       FROM ports WHERE universe_id = $1`, [UNIVERSE_ID]
    );
    const row = res.rows[0];
    assert.ok(row.min_f >= 0 && row.max_f <= 5000, `fuel range out of bounds: ${row.min_f}-${row.max_f}`);
    assert.ok(row.min_o >= 0 && row.max_o <= 5000, `organics range out of bounds: ${row.min_o}-${row.max_o}`);
    assert.ok(row.min_e >= 0 && row.max_e <= 5000, `equipment range out of bounds: ${row.min_e}-${row.max_e}`);
  });

  it('approximately 50% of sectors have ports', async () => {
    const res = await pool.query('SELECT COUNT(*)::int AS count FROM ports WHERE universe_id = $1', [UNIVERSE_ID]);
    const count = res.rows[0].count;
    assert.ok(count >= 20 && count <= 80, `Expected roughly 50 ports, got ${count}`);
  });
});

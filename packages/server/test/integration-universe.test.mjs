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
      `SELECT s.sector_number, COUNT(*)::int AS warp_count
       FROM warps w
       JOIN sectors s ON w.from_sector_id = s.id
       WHERE s.universe_id = $1
       GROUP BY s.sector_number`, [UNIVERSE_ID]
    );
    assert.ok(res.rows.length > 0, 'warps table is empty');
    for (const row of res.rows) {
      assert.ok(
        row.warp_count >= 1 && row.warp_count <= 6,
        `Sector ${row.sector_number} has ${row.warp_count} warps (expected 1-6)`
      );
    }
  });

  it('no self-referential warps exist', async () => {
    const res = await pool.query(
      `SELECT COUNT(*)::int AS count FROM warps w
       JOIN sectors s ON w.from_sector_id = s.id
       WHERE w.from_sector_id = w.to_sector_id AND s.universe_id = $1`, [UNIVERSE_ID]
    );
    assert.equal(res.rows[0].count, 0, 'Found self-referential warps');
  });

  it('no duplicate warps from the same sector', async () => {
    const res = await pool.query(
      `SELECT w.from_sector_id, w.to_sector_id, COUNT(*)::int AS cnt
       FROM warps w
       JOIN sectors s ON w.from_sector_id = s.id
       WHERE s.universe_id = $1
       GROUP BY w.from_sector_id, w.to_sector_id HAVING COUNT(*) > 1`, [UNIVERSE_ID]
    );
    assert.equal(res.rows.length, 0, `Found ${res.rows.length} duplicate warp entries`);
  });

  it('all warp targets reference valid sectors', async () => {
    const res = await pool.query(
      `SELECT w.to_sector_id FROM warps w
       JOIN sectors sf ON w.from_sector_id = sf.id
       LEFT JOIN sectors st ON w.to_sector_id = st.id
       WHERE st.id IS NULL AND sf.universe_id = $1`, [UNIVERSE_ID]
    );
    assert.equal(res.rows.length, 0, `Found ${res.rows.length} warps pointing to non-existent sectors`);
  });

  it('port inventories are within the valid bigbang range (0-5000)', async () => {
    const res = await pool.query(
      `SELECT MIN(p.fuel) AS min_f, MAX(p.fuel) AS max_f,
              MIN(p.organics) AS min_o, MAX(p.organics) AS max_o,
              MIN(p.equipment) AS min_e, MAX(p.equipment) AS max_e
       FROM ports p
       JOIN sectors s ON p.sector_id = s.id
       WHERE s.universe_id = $1`, [UNIVERSE_ID]
    );
    const row = res.rows[0];
    assert.ok(row.min_f >= 0 && row.max_f <= 5000, `fuel range out of bounds: ${row.min_f}-${row.max_f}`);
    assert.ok(row.min_o >= 0 && row.max_o <= 5000, `organics range out of bounds: ${row.min_o}-${row.max_o}`);
    assert.ok(row.min_e >= 0 && row.max_e <= 5000, `equipment range out of bounds: ${row.min_e}-${row.max_e}`);
  });

  it('approximately 80% of sectors have ports', async () => {
    const res = await pool.query(
      `SELECT COUNT(*)::int AS count FROM ports p
       JOIN sectors s ON p.sector_id = s.id
       WHERE s.universe_id = $1`, [UNIVERSE_ID]
    );
    const count = res.rows[0].count;
    // 100 sectors @ 80% density: 80 generated ports + 1 class-0 at sector 1 = ~81
    assert.ok(count >= 75 && count <= 85, `Expected roughly 81 ports, got ${count}`);
  });
});

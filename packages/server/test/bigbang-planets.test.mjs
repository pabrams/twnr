import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { readCSV, generateUniverse } from './bigbang-helpers.mjs';

const VALID_PLANET_TYPES = new Set(['Terran', 'Volcanic', 'Glacial', 'Gas Giant', 'Mountainous']);

/** Returns a Map of value -> count. */
function counter(arr) {
  const map = new Map();
  for (const x of arr) map.set(x, (map.get(x) || 0) + 1);
  return map;
}

// ---------------------------------------------------------------------------
// Planet Generation
// ---------------------------------------------------------------------------

describe('Planet Generation', () => {
  const NUM_SECTORS    = 200;
  const PLANET_DENSITY = 30;
  let outdir, header, rows;

  before(() => {
    outdir = generateUniverse({ sectors: NUM_SECTORS, seed: 42, portDensity: 50, planetDensity: PLANET_DENSITY });
    ({ header, rows } = readCSV(join(outdir, 'planets.csv')));
  });
  after(() => { rmSync(outdir, { recursive: true, force: true }); });

  it('planets.csv has header: sector, planet_name, planet_type', () => {
    assert.deepStrictEqual(header, ['sector', 'planet_name', 'planet_type']);
  });

  it('all planet types are valid', () => {
    for (const row of rows) {
      assert.ok(VALID_PLANET_TYPES.has(row[2]), `Invalid planet type '${row[2]}' in sector ${row[0]}`);
    }
  });

  it('planet type distribution is roughly uniform (when >=25 planets)', () => {
    const types = rows.map(r => r[2]);
    const counts = counter(types);
    if (types.length >= 25) {
      const expected = types.length / VALID_PLANET_TYPES.size;
      for (const pt of VALID_PLANET_TYPES) {
        const count = counts.get(pt) ?? 0;
        assert.ok(count >= expected * 0.25, `Planet type '${pt}': ${count}, expected ~${expected.toFixed(0)}`);
        assert.ok(count <= expected * 2.5,  `Planet type '${pt}': ${count}, expected ~${expected.toFixed(0)}`);
      }
    }
  });

  it('each sector has at most 3 planets', () => {
    const sectorCounts = counter(rows.map(r => r[0]));
    for (const [sector, count] of sectorCounts) {
      assert.ok(count <= 3, `Sector ${sector} has ${count} planets (max 3)`);
    }
  });

  it('sector 1 has exactly one planet — Earth (Terran)', () => {
    const sector1 = rows.filter(r => parseInt(r[0], 10) === 1);
    assert.equal(sector1.length, 1, 'Sector 1 must have exactly one planet (Earth)');
    assert.equal(sector1[0][1], 'Earth');
    assert.equal(sector1[0][2], 'Terran');
  });

  it('all planet sectors are in range 1-N', () => {
    for (const row of rows) {
      const sid = parseInt(row[0], 10);
      assert.ok(sid >= 1 && sid <= NUM_SECTORS, `Planet sector ${sid} out of range`);
    }
  });

  it('number of sectors with planets approximates density %', () => {
    const eligible = NUM_SECTORS - 1;
    const expected = eligible * PLANET_DENSITY / 100;
    const sectorsWithPlanets = new Set(rows.map(r => r[0])).size;
    assert.ok(sectorsWithPlanets >= expected * 0.5, `Too few: ${sectorsWithPlanets}, expected ~${expected}`);
    assert.ok(sectorsWithPlanets <= expected * 1.5, `Too many: ${sectorsWithPlanets}, expected ~${expected}`);
  });

  it('sectors with planets have a mix of 1, 2, and 3 planet counts', () => {
    const sectorCounts = counter(rows.map(r => r[0]));
    const countDistribution = new Set(sectorCounts.values());
    assert.ok(countDistribution.size >= 2,
      `All planet-bearing sectors have the same count; expected a mix of 1-3.`);
  });
});

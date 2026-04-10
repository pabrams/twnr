import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { readCSV, generateUniverse } from './bigbang-helpers.mjs';


// ---------------------------------------------------------------------------
// Sector Generation
// ---------------------------------------------------------------------------

describe('Sector Generation', () => {
  const NUM_SECTORS = 100;
  let outdir, header, rows;

  before(() => {
    outdir = generateUniverse({ sectors: NUM_SECTORS, seed: 42 });
    ({ header, rows } = readCSV(join(outdir, 'sectors.csv')));
  });
  after(() => { rmSync(outdir, { recursive: true, force: true }); });

  it('sectors.csv has header: id, name', () => {
    assert.deepStrictEqual(header, ['id', 'name']);
  });

  it('produces exactly N sector rows', () => {
    assert.equal(rows.length, NUM_SECTORS);
  });

  it('sector IDs are 1 through N', () => {
    const ids = rows.map(r => parseInt(r[0], 10)).sort((a, b) => a - b);
    assert.deepStrictEqual(ids, Array.from({ length: NUM_SECTORS }, (_, i) => i + 1));
  });

  it('sector 1 is named "Federation Space"', () => {
    const sector1 = rows.filter(r => parseInt(r[0], 10) === 1);
    assert.equal(sector1.length, 1);
    assert.equal(sector1[0][1], 'Federation Space');
  });

  it('exactly one sector is named "Starbase"', () => {
    const starbases = rows.filter(r => r[1] === 'Starbase');
    assert.equal(starbases.length, 1, 'There must be exactly one Starbase sector');
  });

  it('Starbase is not sector 1', () => {
    const starbase = rows.find(r => r[1] === 'Starbase');
    assert.notEqual(parseInt(starbase[0], 10), 1, 'Starbase must not be sector 1');
  });

  it('all sectors other than sector 1 and Starbase have empty name', () => {
    for (const row of rows) {
      const sid = parseInt(row[0], 10);
      if (sid === 1 || row[1] === 'Starbase') continue;
      assert.equal(row[1], '', `Sector ${sid} should have empty name, got '${row[1]}'`);
    }
  });
});

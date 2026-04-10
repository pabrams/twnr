import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateUniverse } from './bigbang-helpers.mjs';

// ---------------------------------------------------------------------------
// Seed Reproducibility
// ---------------------------------------------------------------------------

describe('Seed Reproducibility', () => {
  it('same seed + same options produces identical output files', () => {
    const outdir1 = generateUniverse({ sectors: 50, seed: 12345, portDensity: 50, planetDensity: 10, twoWayPct: 70 });
    const outdir2 = generateUniverse({ sectors: 50, seed: 12345, portDensity: 50, planetDensity: 10, twoWayPct: 70 });
    try {
      for (const fname of ['sectors.csv', 'warps.csv', 'ports.csv', 'planets.csv', 'import.sql']) {
        const c1 = readFileSync(join(outdir1, fname), 'utf8');
        const c2 = readFileSync(join(outdir2, fname), 'utf8');
        assert.equal(c1, c2, `${fname} differs between two runs with the same seed`);
      }
    } finally {
      rmSync(outdir1, { recursive: true, force: true });
      rmSync(outdir2, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Output Files
// ---------------------------------------------------------------------------

describe('Output Files', () => {
  let outdir;
  before(() => { outdir = generateUniverse({ sectors: 100, seed: 42, portDensity: 50, planetDensity: 20 }); });
  after(() => { rmSync(outdir, { recursive: true, force: true }); });

  it('sectors.csv exists', () => { assert.ok(existsSync(join(outdir, 'sectors.csv'))); });
  it('warps.csv exists',   () => { assert.ok(existsSync(join(outdir, 'warps.csv'))); });
  it('ports.csv exists',   () => { assert.ok(existsSync(join(outdir, 'ports.csv'))); });
  it('planets.csv exists', () => { assert.ok(existsSync(join(outdir, 'planets.csv'))); });
  it('import.sql exists',  () => { assert.ok(existsSync(join(outdir, 'import.sql'))); });
});

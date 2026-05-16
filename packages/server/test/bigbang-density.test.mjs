import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { readCSV, generateUniverse } from './bigbang-helpers.mjs';


// ---------------------------------------------------------------------------
// Density Boundaries
// ---------------------------------------------------------------------------

describe('Density Boundaries', () => {
  it('--planet-density 0 produces only Earth (sector 1) and no other planets', () => {
    const dir = generateUniverse({ sectors: 50, seed: 99, portDensity: 50, planetDensity: 0 });
    try {
      const { rows } = readCSV(join(dir, 'planets.csv'));
      // Earth is always seeded at sector 1 regardless of planet density.
      assert.equal(rows.length, 1, `Expected 1 planet (Earth), got ${rows.length}`);
      assert.equal(parseInt(rows[0][0], 10), 1, 'Sole planet should be in sector 1');
      assert.equal(rows[0][1], 'Earth', 'Sole planet should be named Earth');
      assert.equal(rows[0][2], 'Terran', 'Earth should be Terran');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('--planet-density 100 produces planets in all eligible sectors (2-N)', () => {
    const N = 50;
    const dir = generateUniverse({ sectors: N, seed: 99, portDensity: 50, planetDensity: 100 });
    try {
      const { rows } = readCSV(join(dir, 'planets.csv'));
      const sectorsWithPlanets = new Set(rows.map(r => parseInt(r[0], 10)));
      const eligible = new Set(Array.from({ length: N - 1 }, (_, i) => i + 2));
      for (const sid of eligible) {
        assert.ok(sectorsWithPlanets.has(sid), `Sector ${sid} should have planets at density 100`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('--port-density 100 produces ports in all eligible sectors (2-N)', () => {
    const N = 50;
    const dir = generateUniverse({ sectors: N, seed: 99, portDensity: 100, planetDensity: 5 });
    try {
      const { rows } = readCSV(join(dir, 'ports.csv'));
      const { rows: sRows } = readCSV(join(dir, 'sectors.csv'));
      // Federation Outposts are class-0 hubs the generator names but doesn't
      // emit into ports.csv (bootstrap inserts them via upsertSpecialPort).
      // Exclude them from the "every sector has a port" check.
      const classZeroSectors = new Set(
        sRows.filter(r => r[1] === 'Federation Outpost').map(r => parseInt(r[0], 10)),
      );
      const sectorsWithPorts = new Set(rows.map(r => parseInt(r[0], 10)));
      const eligible = new Set(Array.from({ length: N - 1 }, (_, i) => i + 2));
      for (const sid of eligible) {
        if (classZeroSectors.has(sid)) continue;
        assert.ok(sectorsWithPorts.has(sid), `Sector ${sid} should have a port at density 100`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('--port-density 10 produces significantly fewer ports than 90', () => {
    const dirLow  = generateUniverse({ sectors: 200, seed: 55, portDensity: 10, planetDensity: 5 });
    const dirHigh = generateUniverse({ sectors: 200, seed: 55, portDensity: 90, planetDensity: 5 });
    try {
      const { rows: low  } = readCSV(join(dirLow,  'ports.csv'));
      const { rows: high } = readCSV(join(dirHigh, 'ports.csv'));
      assert.ok(low.length * 2 < high.length,
        `10% (${low.length} ports) should be well below 90% (${high.length} ports)`);
    } finally {
      rmSync(dirLow,  { recursive: true, force: true });
      rmSync(dirHigh, { recursive: true, force: true });
    }
  });

  it('--planet-density 5 produces significantly fewer planet-sectors than 80', () => {
    const dirLow  = generateUniverse({ sectors: 200, seed: 55, portDensity: 50, planetDensity: 5 });
    const dirHigh = generateUniverse({ sectors: 200, seed: 55, portDensity: 50, planetDensity: 80 });
    try {
      const low  = new Set(readCSV(join(dirLow,  'planets.csv')).rows.map(r => r[0])).size;
      const high = new Set(readCSV(join(dirHigh, 'planets.csv')).rows.map(r => r[0])).size;
      assert.ok(low * 2 < high,
        `5% (${low} sectors) should be well below 80% (${high} sectors)`);
    } finally {
      rmSync(dirLow,  { recursive: true, force: true });
      rmSync(dirHigh, { recursive: true, force: true });
    }
  });

  it('--port-density 10 approximates 10% of eligible sectors', () => {
    const N = 200;
    const dir = generateUniverse({ sectors: N, seed: 77, portDensity: 10, planetDensity: 5 });
    try {
      const { rows } = readCSV(join(dir, 'ports.csv'));
      const eligible = N - 1;
      const expected = eligible * 10 / 100;
      assert.ok(rows.length >= expected * 0.4, `port-density 10: got ${rows.length}, expected ~${expected}`);
      assert.ok(rows.length <= expected * 2.0, `port-density 10: got ${rows.length}, expected ~${expected}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('--planet-density 50 approximates 50% of eligible sectors', () => {
    const N = 200;
    const dir = generateUniverse({ sectors: N, seed: 77, portDensity: 50, planetDensity: 50 });
    try {
      const { rows } = readCSV(join(dir, 'planets.csv'));
      const eligible = N - 1;
      const expected = eligible * 50 / 100;
      const sectorsWithPlanets = new Set(rows.map(r => r[0])).size;
      assert.ok(sectorsWithPlanets >= expected * 0.5, `planet-density 50: got ${sectorsWithPlanets}, expected ~${expected}`);
      assert.ok(sectorsWithPlanets <= expected * 1.5, `planet-density 50: got ${sectorsWithPlanets}, expected ~${expected}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

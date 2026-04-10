import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, readFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');
const BIGBANG_SCRIPT = join(PROJECT_ROOT, 'scripts', 'twnr-bigbang.js');

const VALID_PLANET_TYPES = new Set(['Earth-like', 'Volcanic', 'Glacial', 'Gaseous', 'Mountainous']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuote = false;
  for (const ch of line) {
    if (ch === '"') { inQuote = !inQuote; }
    else if (ch === ',' && !inQuote) { result.push(current); current = ''; }
    else { current += ch; }
  }
  result.push(current);
  return result;
}

function readCSV(filepath) {
  const content = readFileSync(filepath, 'utf8');
  const lines = content.trim().split('\n');
  const header = parseCSVLine(lines[0]);
  const rows = lines.slice(1).filter(l => l.length > 0).map(parseCSVLine);
  return { header, rows };
}

function runCLI(args) {
  const result = spawnSync(process.execPath, [BIGBANG_SCRIPT, ...args], {
    encoding: 'utf8',
    cwd: PROJECT_ROOT,
  });
  return { rc: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'bigbang_test_'));
}

function generateUniverse({
  sectors = 100, seed = 42, portDensity = null, planetDensity = null, twoWayPct = null,
} = {}) {
  const outdir = makeTempDir();
  rmSync(outdir, { recursive: true, force: true });
  const args = [outdir, '--sectors', String(sectors), '--seed', String(seed)];
  if (portDensity  !== null) args.push('--port-density',   String(portDensity));
  if (planetDensity !== null) args.push('--planet-density', String(planetDensity));
  if (twoWayPct    !== null) args.push('--two-way-pct',    String(twoWayPct));
  const { rc, stderr } = runCLI(args);
  if (rc !== 0) throw new Error(`CLI failed (rc=${rc}): ${stderr}`);
  return outdir;
}

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

  it('sector 1 has no planets', () => {
    const sector1 = rows.filter(r => parseInt(r[0], 10) === 1);
    assert.equal(sector1.length, 0, 'Sector 1 must not have planets');
  });

  it('planet names follow {planet_type}-{sector_id}-{index} format with sequential indices', () => {
    const bySecotr = new Map();
    for (const row of rows) {
      const sid = parseInt(row[0], 10);
      if (!bySecotr.has(sid)) bySecotr.set(sid, []);
      bySecotr.get(sid).push(row);
    }
    for (const [sector, planets] of bySecotr) {
      const indicesSeen = [];
      for (const row of planets) {
        const name  = row[1];
        const ptype = row[2];
        const prefix = `${ptype}-${sector}-`;
        assert.ok(name.startsWith(prefix), `Planet name '${name}' should start with '${prefix}'`);
        const suffix = name.slice(prefix.length);
        assert.ok(/^\d+$/.test(suffix), `Planet name '${name}' index '${suffix}' is not a number`);
        indicesSeen.push(parseInt(suffix, 10));
      }
      const expected = Array.from({ length: planets.length }, (_, i) => i + 1);
      assert.deepStrictEqual(indicesSeen.sort((a, b) => a - b), expected,
        `Sector ${sector}: planet indices ${indicesSeen} should be ${expected}`);
    }
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

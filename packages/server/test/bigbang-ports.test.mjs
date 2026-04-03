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

const PORT_CLASSES = {
  1: ['B', 'B', 'S'],
  2: ['B', 'S', 'B'],
  3: ['S', 'B', 'B'],
  4: ['S', 'S', 'B'],
  5: ['B', 'S', 'S'],
  6: ['S', 'B', 'S'],
  7: ['S', 'S', 'S'],
  8: ['B', 'B', 'B'],
};

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
// Port Generation
// ---------------------------------------------------------------------------

describe('Port Generation', () => {
  const NUM_SECTORS  = 200;
  const PORT_DENSITY = 60;
  let outdir, header, rows, stardockSector;

  before(() => {
    outdir = generateUniverse({ sectors: NUM_SECTORS, seed: 42, portDensity: PORT_DENSITY, planetDensity: 10 });
    ({ header, rows } = readCSV(join(outdir, 'ports.csv')));
    const { rows: sRows } = readCSV(join(outdir, 'sectors.csv'));
    const stardockRow = sRows.find(r => r[1] === 'Stardock');
    stardockSector = stardockRow ? parseInt(stardockRow[0], 10) : null;
  });
  after(() => { rmSync(outdir, { recursive: true, force: true }); });

  it('ports.csv has correct header columns', () => {
    assert.deepStrictEqual(header,
      ['sector', 'class', 'fuel_qty', 'fuel_price', 'org_qty', 'org_price', 'equ_qty', 'equ_price']);
  });

  it('all port classes are 1-8', () => {
    for (const row of rows) {
      const pc = parseInt(row[1], 10);
      assert.ok(pc >= 1 && pc <= 8, `Invalid port class ${pc} in sector ${row[0]}`);
    }
  });

  it('port class distribution is roughly uniform (when >=40 ports)', () => {
    const classes = rows.map(r => parseInt(r[1], 10));
    const counts = counter(classes);
    if (classes.length >= 40) {
      const expected = classes.length / 8;
      for (let c = 1; c <= 8; c++) {
        const count = counts.get(c) ?? 0;
        assert.ok(count >= expected * 0.25, `Port class ${c}: ${count} ports, expected ~${expected.toFixed(0)}`);
        assert.ok(count <= expected * 2.5,  `Port class ${c}: ${count} ports, expected ~${expected.toFixed(0)}`);
      }
    }
  });

  it('Stardock sector has exactly one class 8 port', () => {
    assert.ok(stardockSector != null, 'Stardock sector not found');
    const stardockPorts = rows.filter(r => parseInt(r[0], 10) === stardockSector);
    assert.equal(stardockPorts.length, 1, 'Stardock must have exactly 1 port');
    assert.equal(parseInt(stardockPorts[0][1], 10), 8, 'Stardock port must be class 8');
  });

  it('sector 1 (Federation Space) has no port', () => {
    const sector1Ports = rows.filter(r => parseInt(r[0], 10) === 1);
    assert.equal(sector1Ports.length, 0, 'Sector 1 must not have a port');
  });

  it('at most one port per sector', () => {
    const sectorCounts = counter(rows.map(r => r[0]));
    for (const [sector, count] of sectorCounts) {
      assert.ok(count <= 1, `Sector ${sector} has ${count} ports (max 1)`);
    }
  });

  it('all commodity quantities are 0-5000', () => {
    for (const row of rows) {
      for (const idx of [2, 4, 6]) {
        const qty = parseInt(row[idx], 10);
        assert.ok(qty >= 0,    `Sector ${row[0]}: quantity ${qty} < 0`);
        assert.ok(qty <= 5000, `Sector ${row[0]}: quantity ${qty} > 5000`);
      }
    }
  });

  it('sell prices are 10-50', () => {
    for (const row of rows) {
      const pc = parseInt(row[1], 10);
      const bsa = PORT_CLASSES[pc];
      const priceIndices = [3, 5, 7];
      for (let i = 0; i < bsa.length; i++) {
        if (bsa[i] === 'S') {
          const price = parseInt(row[priceIndices[i]], 10);
          assert.ok(price >= 10, `Sector ${row[0]} class ${pc}: sell price ${price} < 10`);
          assert.ok(price <= 50, `Sector ${row[0]} class ${pc}: sell price ${price} > 50`);
        }
      }
    }
  });

  it('buy prices are 51-100', () => {
    for (const row of rows) {
      const pc = parseInt(row[1], 10);
      const bsa = PORT_CLASSES[pc];
      const priceIndices = [3, 5, 7];
      for (let i = 0; i < bsa.length; i++) {
        if (bsa[i] === 'B') {
          const price = parseInt(row[priceIndices[i]], 10);
          assert.ok(price >= 51,  `Sector ${row[0]} class ${pc}: buy price ${price} < 51`);
          assert.ok(price <= 100, `Sector ${row[0]} class ${pc}: buy price ${price} > 100`);
        }
      }
    }
  });

  it('port count approximates density %', () => {
    const eligible = NUM_SECTORS - 1;
    const expected = eligible * PORT_DENSITY / 100;
    const actual = rows.length;
    assert.ok(actual >= expected * 0.5, `Too few ports: ${actual}, expected ~${expected}`);
    assert.ok(actual <= expected * 1.5, `Too many ports: ${actual}, expected ~${expected}`);
  });
});

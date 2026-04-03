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

  it('exactly one sector is named "Stardock"', () => {
    const stardocks = rows.filter(r => r[1] === 'Stardock');
    assert.equal(stardocks.length, 1, 'There must be exactly one Stardock sector');
  });

  it('Stardock is not sector 1', () => {
    const stardock = rows.find(r => r[1] === 'Stardock');
    assert.notEqual(parseInt(stardock[0], 10), 1, 'Stardock must not be sector 1');
  });

  it('all sectors other than sector 1 and Stardock have empty name', () => {
    for (const row of rows) {
      const sid = parseInt(row[0], 10);
      if (sid === 1 || row[1] === 'Stardock') continue;
      assert.equal(row[1], '', `Sector ${sid} should have empty name, got '${row[1]}'`);
    }
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync,
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

function computeBidirectionalPct(rows) {
  const warpSet = new Set(rows.map(r => `${r[0]},${r[1]}`));
  const total = warpSet.size;
  if (total === 0) return { bidiCount: 0, total: 0, pct: 0 };
  let bidiCount = 0;
  for (const entry of warpSet) {
    const [a, b] = entry.split(',');
    if (warpSet.has(`${b},${a}`)) bidiCount++;
  }
  return { bidiCount, total, pct: (bidiCount / total) * 100 };
}

// ---------------------------------------------------------------------------
// CLI Argument Validation
// ---------------------------------------------------------------------------

describe('CLI Argument Validation', () => {
  it('missing --sectors flag exits 1 with error on stderr', () => {
    const outdir = makeTempDir();
    rmSync(outdir, { recursive: true, force: true });
    const { rc, stderr } = runCLI([outdir]);
    assert.equal(rc, 1, 'Should exit 1 when --sectors is missing');
    assert.ok(stderr.trim().length > 0, 'Should print error to stderr');
  });

  it('--sectors below minimum (19) exits 1', () => {
    const outdir = makeTempDir();
    rmSync(outdir, { recursive: true, force: true });
    const { rc, stderr } = runCLI([outdir, '--sectors', '19']);
    assert.equal(rc, 1);
    assert.ok(stderr.trim().length > 0);
  });

  it('--sectors above maximum (5001) exits 1', () => {
    const outdir = makeTempDir();
    rmSync(outdir, { recursive: true, force: true });
    const { rc, stderr } = runCLI([outdir, '--sectors', '5001']);
    assert.equal(rc, 1);
    assert.ok(stderr.trim().length > 0);
  });

  it('existing non-empty output directory exits 1', () => {
    const outdir = makeTempDir();
    writeFileSync(join(outdir, 'dummy.txt'), 'dummy');
    const { rc, stderr } = runCLI([outdir, '--sectors', '20']);
    assert.equal(rc, 1, 'Should exit 1 for non-empty output dir');
    assert.ok(stderr.trim().length > 0);
    rmSync(outdir, { recursive: true, force: true });
  });

  it('output directory is created when it does not exist', () => {
    const outdir = makeTempDir();
    rmSync(outdir, { recursive: true, force: true });
    const { rc, stderr } = runCLI([outdir, '--sectors', '20', '--seed', '1']);
    assert.equal(rc, 0, `Should exit 0. stderr: ${stderr}`);
    assert.ok(existsSync(outdir), 'Output dir should be created');
    rmSync(outdir, { recursive: true, force: true });
  });

  it('valid invocation exits 0', () => {
    const outdir = makeTempDir();
    rmSync(outdir, { recursive: true, force: true });
    const { rc, stderr } = runCLI([outdir, '--sectors', '20', '--seed', '1']);
    assert.equal(rc, 0, `Should exit 0. stderr: ${stderr}`);
    rmSync(outdir, { recursive: true, force: true });
  });

  it('--port-density 0 exits 1 (range is 1-100)', () => {
    const outdir = makeTempDir();
    rmSync(outdir, { recursive: true, force: true });
    const { rc, stderr } = runCLI([outdir, '--sectors', '20', '--port-density', '0']);
    assert.equal(rc, 1);
    assert.ok(stderr.trim().length > 0);
  });

  it('--port-density 101 exits 1', () => {
    const outdir = makeTempDir();
    rmSync(outdir, { recursive: true, force: true });
    const { rc, stderr } = runCLI([outdir, '--sectors', '20', '--port-density', '101']);
    assert.equal(rc, 1);
    assert.ok(stderr.trim().length > 0);
  });

  it('--planet-density 101 exits 1', () => {
    const outdir = makeTempDir();
    rmSync(outdir, { recursive: true, force: true });
    const { rc, stderr } = runCLI([outdir, '--sectors', '20', '--planet-density', '101']);
    assert.equal(rc, 1);
    assert.ok(stderr.trim().length > 0);
  });

  it('--two-way-pct -1 exits 1', () => {
    const outdir = makeTempDir();
    rmSync(outdir, { recursive: true, force: true });
    const { rc, stderr } = runCLI([outdir, '--sectors', '20', '--two-way-pct', '-1']);
    assert.equal(rc, 1);
    assert.ok(stderr.trim().length > 0);
  });

  it('--two-way-pct 101 exits 1', () => {
    const outdir = makeTempDir();
    rmSync(outdir, { recursive: true, force: true });
    const { rc, stderr } = runCLI([outdir, '--sectors', '20', '--two-way-pct', '101']);
    assert.equal(rc, 1);
    assert.ok(stderr.trim().length > 0);
  });

  it('existing empty output directory is accepted', () => {
    const outdir = makeTempDir();
    const { rc, stderr } = runCLI([outdir, '--sectors', '20', '--seed', '1']);
    assert.equal(rc, 0, `Existing empty dir should succeed. stderr: ${stderr}`);
    assert.ok(existsSync(join(outdir, 'sectors.csv')));
    rmSync(outdir, { recursive: true, force: true });
  });

  it('--sectors 20 (minimum) produces exactly 20 sector rows', () => {
    const outdir = makeTempDir();
    rmSync(outdir, { recursive: true, force: true });
    const { rc, stderr } = runCLI([outdir, '--sectors', '20', '--seed', '1']);
    assert.equal(rc, 0, `Should exit 0. stderr: ${stderr}`);
    const { rows } = readCSV(join(outdir, 'sectors.csv'));
    assert.equal(rows.length, 20, `Expected 20 sectors, got ${rows.length}`);
    rmSync(outdir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Default Values
// ---------------------------------------------------------------------------

describe('Default Values', () => {
  it('omitting --port-density defaults to ~50%', () => {
    const outdir = generateUniverse({ sectors: 100, seed: 777 });
    try {
      const { rows } = readCSV(join(outdir, 'ports.csv'));
      const expected = 99 * 50 / 100;
      const actual = rows.length;
      assert.ok(actual >= expected * 0.5, `Too few ports: ${actual}, expected ~${expected}`);
      assert.ok(actual <= expected * 1.5, `Too many ports: ${actual}, expected ~${expected}`);
    } finally { rmSync(outdir, { recursive: true, force: true }); }
  });

  it('omitting --planet-density defaults to ~5%', () => {
    const outdir = generateUniverse({ sectors: 200, seed: 777 });
    try {
      const { rows } = readCSV(join(outdir, 'planets.csv'));
      const sectorsWithPlanets = new Set(rows.map(r => r[0])).size;
      const expected = 199 * 5 / 100;
      assert.ok(sectorsWithPlanets >= Math.max(1, expected * 0.3),
        `Too few planet sectors: ${sectorsWithPlanets}, expected ~${expected}`);
      assert.ok(sectorsWithPlanets <= expected * 3,
        `Too many planet sectors: ${sectorsWithPlanets}, expected ~${expected}`);
    } finally { rmSync(outdir, { recursive: true, force: true }); }
  });

  it('omitting --two-way-pct defaults to ~90% bidirectional', () => {
    const outdir = generateUniverse({ sectors: 100, seed: 777 });
    try {
      const { rows } = readCSV(join(outdir, 'warps.csv'));
      const { pct } = computeBidirectionalPct(rows);
      assert.ok(pct >= 89.0, `Default two-way-pct should be ~90%, got ${pct.toFixed(1)}%`);
      assert.ok(pct <= 91.0, `Default two-way-pct should be ~90%, got ${pct.toFixed(1)}%`);
    } finally { rmSync(outdir, { recursive: true, force: true }); }
  });

  it('omitting all optional params produces all 5 output files', () => {
    const outdir = generateUniverse({ sectors: 20, seed: 1 });
    try {
      for (const fname of ['sectors.csv', 'warps.csv', 'ports.csv', 'planets.csv', 'import.sql']) {
        assert.ok(existsSync(join(outdir, fname)), `${fname} should exist`);
      }
    } finally { rmSync(outdir, { recursive: true, force: true }); }
  });
});

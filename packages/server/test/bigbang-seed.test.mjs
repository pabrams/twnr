import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, existsSync, readFileSync,
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

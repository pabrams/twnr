import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync,
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

/**
 * Run the twnr-bigbang.js CLI with the given argument array.
 * Returns { rc, stdout, stderr }.
 */
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

/**
 * Generate a universe and return the output directory path.
 * Throws if the CLI exits non-zero.
 * Pass undefined (or omit) for portDensity/planetDensity/twoWayPct to use CLI defaults.
 */
/**
 * portDensity / planetDensity default to null, meaning the CLI's own defaults are used.
 * Pass explicit numbers to override.
 */
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

/** Returns a Map of value → count. */
function counter(arr) {
  const map = new Map();
  for (const x of arr) map.set(x, (map.get(x) || 0) + 1);
  return map;
}

/**
 * Compute bidirectional warp percentage from warp rows.
 * Returns { bidiCount, total, pct }.
 */
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

/**
 * Assert strong connectivity of the directed warp graph via dual BFS from sector 1.
 */
function checkStrongConnectivity(warpRows, numSectors, label = '') {
  const adj = new Map();
  const revAdj = new Map();

  for (const row of warpRows) {
    const from = parseInt(row[0], 10);
    const to = parseInt(row[1], 10);
    if (!adj.has(from)) adj.set(from, new Set());
    if (!revAdj.has(to)) revAdj.set(to, new Set());
    adj.get(from).add(to);
    revAdj.get(to).add(from);
  }

  // Forward BFS
  const visited = new Set([1]);
  const queue = [1];
  while (queue.length > 0) {
    const curr = queue.shift();
    for (const nb of (adj.get(curr) || [])) {
      if (!visited.has(nb)) { visited.add(nb); queue.push(nb); }
    }
  }
  assert.equal(visited.size, numSectors,
    `${label}Forward BFS reached ${visited.size}/${numSectors} sectors`);

  // Reverse BFS
  const visitedRev = new Set([1]);
  const qRev = [1];
  while (qRev.length > 0) {
    const curr = qRev.shift();
    for (const nb of (revAdj.get(curr) || [])) {
      if (!visitedRev.has(nb)) { visitedRev.add(nb); qRev.push(nb); }
    }
  }
  assert.equal(visitedRev.size, numSectors,
    `${label}Reverse BFS reached ${visitedRev.size}/${numSectors} sectors`);
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
    // portDensity: null (default) → CLI uses its built-in default of 50
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

// ---------------------------------------------------------------------------
// Warp Generation
// ---------------------------------------------------------------------------

describe('Warp Generation', () => {
  const NUM_SECTORS = 100;
  let outdir, header, rows;

  before(() => {
    outdir = generateUniverse({ sectors: NUM_SECTORS, seed: 42 });
    ({ header, rows } = readCSV(join(outdir, 'warps.csv')));
  });
  after(() => { rmSync(outdir, { recursive: true, force: true }); });

  it('warps.csv has header: sector_from, sector_to', () => {
    assert.deepStrictEqual(header, ['sector_from', 'sector_to']);
  });

  it('each sector has 1-6 outbound warps', () => {
    const outbound = counter(rows.map(r => parseInt(r[0], 10)));
    for (let sid = 1; sid <= NUM_SECTORS; sid++) {
      const count = outbound.get(sid) ?? 0;
      assert.ok(count >= 1, `Sector ${sid} has ${count} outbound warps (min 1)`);
      assert.ok(count <= 6, `Sector ${sid} has ${count} outbound warps (max 6)`);
    }
  });

  it('each sector has 1-6 inbound warps', () => {
    const inbound = counter(rows.map(r => parseInt(r[1], 10)));
    for (let sid = 1; sid <= NUM_SECTORS; sid++) {
      const count = inbound.get(sid) ?? 0;
      assert.ok(count >= 1, `Sector ${sid} has ${count} inbound warps (min 1)`);
      assert.ok(count <= 6, `Sector ${sid} has ${count} inbound warps (max 6)`);
    }
  });

  it('no self-warps', () => {
    for (const row of rows) {
      assert.notEqual(row[0], row[1], `Self-warp detected: sector ${row[0]}`);
    }
  });

  it('no duplicate warp pairs', () => {
    const pairs = rows.map(r => `${r[0]},${r[1]}`);
    assert.equal(pairs.length, new Set(pairs).size, 'Duplicate warps detected');
  });

  it('all warp sector IDs in range 1-N', () => {
    for (const row of rows) {
      const sf = parseInt(row[0], 10);
      const st = parseInt(row[1], 10);
      assert.ok(sf >= 1 && sf <= NUM_SECTORS, `sector_from ${sf} out of range`);
      assert.ok(st >= 1 && st <= NUM_SECTORS, `sector_to ${st} out of range`);
    }
  });

  it('graph is strongly connected', () => {
    checkStrongConnectivity(rows, NUM_SECTORS);
  });

  it('graph is strongly connected at 500 sectors', { timeout: 60000 }, () => {
    const dir = generateUniverse({ sectors: 500, seed: 99 });
    try {
      const { rows: wr } = readCSV(join(dir, 'warps.csv'));
      checkStrongConnectivity(wr, 500, '500 sectors: ');
      const inbound = counter(wr.map(r => parseInt(r[1], 10)));
      for (let sid = 1; sid <= 500; sid++) {
        const c = inbound.get(sid) ?? 0;
        assert.ok(c >= 1, `500 sectors: sector ${sid} has ${c} inbound (min 1)`);
        assert.ok(c <= 6, `500 sectors: sector ${sid} has ${c} inbound (max 6)`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('graph is strongly connected at 500 sectors with --two-way-pct 0', { timeout: 60000 }, () => {
    const dir = generateUniverse({ sectors: 500, seed: 99, twoWayPct: 0 });
    try {
      const { rows: wr } = readCSV(join(dir, 'warps.csv'));
      checkStrongConnectivity(wr, 500, '500 sectors, two-way-pct=0: ');
      const inbound = counter(wr.map(r => parseInt(r[1], 10)));
      for (let sid = 1; sid <= 500; sid++) {
        const c = inbound.get(sid) ?? 0;
        assert.ok(c >= 1, `500s twp=0: sector ${sid} has ${c} inbound (min 1)`);
        assert.ok(c <= 6, `500s twp=0: sector ${sid} has ${c} inbound (max 6)`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('all warp constraints hold at 20 sectors (minimum) for twp 0, 50, 100', () => {
    for (const twp of [0, 50, 100]) {
      const dir = generateUniverse({ sectors: 20, seed: 42, twoWayPct: twp });
      try {
        const { rows: wr } = readCSV(join(dir, 'warps.csv'));
        checkStrongConnectivity(wr, 20, `20 sectors, twp=${twp}: `);

        const outbound = counter(wr.map(r => parseInt(r[0], 10)));
        const inbound  = counter(wr.map(r => parseInt(r[1], 10)));
        for (let sid = 1; sid <= 20; sid++) {
          assert.ok((outbound.get(sid) ?? 0) >= 1, `20s twp=${twp}: sector ${sid} outbound < 1`);
          assert.ok((outbound.get(sid) ?? 0) <= 6, `20s twp=${twp}: sector ${sid} outbound > 6`);
          assert.ok((inbound.get(sid) ?? 0) >= 1,  `20s twp=${twp}: sector ${sid} inbound < 1`);
          assert.ok((inbound.get(sid) ?? 0) <= 6,  `20s twp=${twp}: sector ${sid} inbound > 6`);
        }

        const pairs = wr.map(r => `${r[0]},${r[1]}`);
        assert.equal(pairs.length, new Set(pairs).size, `20s twp=${twp}: duplicate warps`);
        for (const row of wr) {
          assert.notEqual(row[0], row[1], `20s twp=${twp}: self-warp in sector ${row[0]}`);
        }

        const warpSet = new Set(wr.map(r => `${r[0]},${r[1]}`));
        const bidi = [...warpSet].filter(e => { const [a, b] = e.split(','); return warpSet.has(`${b},${a}`); }).length;
        const pct = (bidi / warpSet.size) * 100;
        const low = Math.max(0, twp - 1);
        const high = Math.min(100, twp + 1);
        assert.ok(pct >= low, `20s twp=${twp}: bidirectional ${pct.toFixed(1)}% below ${low}%`);
        assert.ok(pct <= high, `20s twp=${twp}: bidirectional ${pct.toFixed(1)}% above ${high}%`);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }
  });
});

// ---------------------------------------------------------------------------
// Bidirectional Warp Percentage
// ---------------------------------------------------------------------------

describe('Bidirectional Warp Percentage', () => {
  function assertTwoWayPctInRange(rows, target, label = '') {
    const { pct } = computeBidirectionalPct(rows);
    const low  = Math.max(0, target - 1);
    const high = Math.min(100, target + 1);
    assert.ok(pct >= low,  `${label}Bidirectional ${pct.toFixed(1)}% below [${low}%-${high}%] for target ${target}%`);
    assert.ok(pct <= high, `${label}Bidirectional ${pct.toFixed(1)}% above [${low}%-${high}%] for target ${target}%`);
  }

  it('default (no --two-way-pct) gives ~90%', () => {
    const dir = generateUniverse({ sectors: 100, seed: 42 });
    try { assertTwoWayPctInRange(readCSV(join(dir, 'warps.csv')).rows, 90, 'Default: '); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('--two-way-pct 0 gives 0%-1%', () => {
    const dir = generateUniverse({ sectors: 100, seed: 42, twoWayPct: 0 });
    try { assertTwoWayPctInRange(readCSV(join(dir, 'warps.csv')).rows, 0, 'twp=0: '); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('--two-way-pct 100 gives 99%-100%', () => {
    const dir = generateUniverse({ sectors: 100, seed: 42, twoWayPct: 100 });
    try { assertTwoWayPctInRange(readCSV(join(dir, 'warps.csv')).rows, 100, 'twp=100: '); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('--two-way-pct 50 gives 49%-51%', () => {
    const dir = generateUniverse({ sectors: 100, seed: 42, twoWayPct: 50 });
    try { assertTwoWayPctInRange(readCSV(join(dir, 'warps.csv')).rows, 50, 'twp=50: '); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('--two-way-pct 20 gives 19%-21%', () => {
    const dir = generateUniverse({ sectors: 100, seed: 42, twoWayPct: 20 });
    try { assertTwoWayPctInRange(readCSV(join(dir, 'warps.csv')).rows, 20, 'twp=20: '); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('--two-way-pct 10 produces fewer bidirectional warps than 90', () => {
    const dirLow  = generateUniverse({ sectors: 100, seed: 42, twoWayPct: 10 });
    const dirHigh = generateUniverse({ sectors: 100, seed: 42, twoWayPct: 90 });
    try {
      const { pct: pctLow  } = computeBidirectionalPct(readCSV(join(dirLow,  'warps.csv')).rows);
      const { pct: pctHigh } = computeBidirectionalPct(readCSV(join(dirHigh, 'warps.csv')).rows);
      assert.ok(pctLow < pctHigh, `twp=10 gave ${pctLow.toFixed(1)}% but twp=90 gave ${pctHigh.toFixed(1)}%`);
    } finally {
      rmSync(dirLow,  { recursive: true, force: true });
      rmSync(dirHigh, { recursive: true, force: true });
    }
  });

  it('--two-way-pct 0 graph is still strongly connected', () => {
    const dir = generateUniverse({ sectors: 100, seed: 42, twoWayPct: 0 });
    try { checkStrongConnectivity(readCSV(join(dir, 'warps.csv')).rows, 100, 'twp=0: '); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('--two-way-pct 100 still respects degree limits (≤6 in/out)', () => {
    const dir = generateUniverse({ sectors: 100, seed: 42, twoWayPct: 100 });
    try {
      const { rows } = readCSV(join(dir, 'warps.csv'));
      const outbound = counter(rows.map(r => parseInt(r[0], 10)));
      const inbound  = counter(rows.map(r => parseInt(r[1], 10)));
      for (let sid = 1; sid <= 100; sid++) {
        assert.ok((outbound.get(sid) ?? 0) <= 6, `Sector ${sid} outbound > 6 with twp=100`);
        assert.ok((inbound.get(sid) ?? 0) <= 6,  `Sector ${sid} inbound > 6 with twp=100`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('--two-way-pct 0 still respects degree limits (200 sectors)', () => {
    const dir = generateUniverse({ sectors: 200, seed: 42, twoWayPct: 0 });
    try {
      const { rows } = readCSV(join(dir, 'warps.csv'));
      const inbound = counter(rows.map(r => parseInt(r[1], 10)));
      for (let sid = 1; sid <= 200; sid++) {
        const c = inbound.get(sid) ?? 0;
        assert.ok(c >= 1, `Sector ${sid} has ${c} inbound with twp=0 (min 1)`);
        assert.ok(c <= 6, `Sector ${sid} has ${c} inbound with twp=0 (max 6)`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('bidirectional % within ±1% at 1000 sectors for targets 10, 50, 90', { timeout: 180000 }, () => {
    for (const target of [10, 50, 90]) {
      const dir = generateUniverse({ sectors: 1000, seed: 42, twoWayPct: target });
      try {
        const { rows } = readCSV(join(dir, 'warps.csv'));
        assertTwoWayPctInRange(rows, target, `1000s target=${target}: `);

        const outbound = counter(rows.map(r => parseInt(r[0], 10)));
        const inbound  = counter(rows.map(r => parseInt(r[1], 10)));
        for (let sid = 1; sid <= 1000; sid++) {
          assert.ok((outbound.get(sid) ?? 0) >= 1, `Sector ${sid} 0 outbound at 1000s twp=${target}`);
          assert.ok((outbound.get(sid) ?? 0) <= 6, `Sector ${sid} outbound > 6 at 1000s twp=${target}`);
          assert.ok((inbound.get(sid) ?? 0) >= 1,  `Sector ${sid} 0 inbound at 1000s twp=${target}`);
          assert.ok((inbound.get(sid) ?? 0) <= 6,  `Sector ${sid} inbound > 6 at 1000s twp=${target}`);
        }

        // Forward BFS only (reverse is expensive; forward is the critical check)
        const adj = new Map();
        for (const row of rows) {
          const from = parseInt(row[0], 10);
          const to   = parseInt(row[1], 10);
          if (!adj.has(from)) adj.set(from, new Set());
          adj.get(from).add(to);
        }
        const visited = new Set([1]);
        const queue = [1];
        while (queue.length > 0) {
          const curr = queue.shift();
          for (const nb of (adj.get(curr) || [])) {
            if (!visited.has(nb)) { visited.add(nb); queue.push(nb); }
          }
        }
        assert.equal(visited.size, 1000, `Forward BFS only reached ${visited.size}/1000 at twp=${target}`);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }
  });
});

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

  it('port class distribution is roughly uniform (when ≥40 ports)', () => {
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

  it('planet type distribution is roughly uniform (when ≥25 planets)', () => {
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

// ---------------------------------------------------------------------------
// Density Boundaries
// ---------------------------------------------------------------------------

describe('Density Boundaries', () => {
  it('--planet-density 0 produces no planet rows', () => {
    const dir = generateUniverse({ sectors: 50, seed: 99, portDensity: 50, planetDensity: 0 });
    try {
      const { rows } = readCSV(join(dir, 'planets.csv'));
      assert.equal(rows.length, 0, `Expected 0 planets, got ${rows.length}`);
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
      const sectorsWithPorts = new Set(rows.map(r => parseInt(r[0], 10)));
      const eligible = new Set(Array.from({ length: N - 1 }, (_, i) => i + 2));
      for (const sid of eligible) {
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

// ---------------------------------------------------------------------------
// Referential Integrity
// ---------------------------------------------------------------------------

describe('Referential Integrity', () => {
  let outdir, validSectorIds, sectorRows, warpRows, portRows, planetRows;

  before(() => {
    outdir = generateUniverse({ sectors: 100, seed: 42, portDensity: 60, planetDensity: 30 });
    ({ rows: sectorRows } = readCSV(join(outdir, 'sectors.csv')));
    ({ rows: warpRows }   = readCSV(join(outdir, 'warps.csv')));
    ({ rows: portRows }   = readCSV(join(outdir, 'ports.csv')));
    ({ rows: planetRows } = readCSV(join(outdir, 'planets.csv')));
    validSectorIds = new Set(sectorRows.map(r => parseInt(r[0], 10)));
  });
  after(() => { rmSync(outdir, { recursive: true, force: true }); });

  it('every sector_from in warps.csv exists in sectors.csv', () => {
    for (const row of warpRows) {
      assert.ok(validSectorIds.has(parseInt(row[0], 10)),
        `Warp references non-existent source sector ${row[0]}`);
    }
  });

  it('every sector_to in warps.csv exists in sectors.csv', () => {
    for (const row of warpRows) {
      assert.ok(validSectorIds.has(parseInt(row[1], 10)),
        `Warp references non-existent destination sector ${row[1]}`);
    }
  });

  it('every sector in ports.csv exists in sectors.csv', () => {
    for (const row of portRows) {
      assert.ok(validSectorIds.has(parseInt(row[0], 10)),
        `Port references non-existent sector ${row[0]}`);
    }
  });

  it('every sector in planets.csv exists in sectors.csv', () => {
    for (const row of planetRows) {
      assert.ok(validSectorIds.has(parseInt(row[0], 10)),
        `Planet references non-existent sector ${row[0]}`);
    }
  });

  it('import.sql references all four CSV filenames', () => {
    const sql = readFileSync(join(outdir, 'import.sql'), 'utf8');
    for (const csv of ['sectors.csv', 'warps.csv', 'ports.csv', 'planets.csv']) {
      assert.ok(sql.includes(csv), `import.sql should reference ${csv}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Import SQL
// ---------------------------------------------------------------------------

describe('Import SQL', () => {
  let outdir, sql, sqlStripped;

  before(() => {
    outdir = generateUniverse({ sectors: 50, seed: 42 });
    sql = readFileSync(join(outdir, 'import.sql'), 'utf8');
    sqlStripped = sql.trim();
  });
  after(() => { rmSync(outdir, { recursive: true, force: true }); });

  it('begins with BEGIN;', () => {
    assert.ok(sqlStripped.startsWith('BEGIN;'), `Starts with: '${sqlStripped.slice(0, 50)}'`);
  });

  it('ends with COMMIT;', () => {
    assert.ok(sqlStripped.endsWith('COMMIT;'), `Ends with: '${sqlStripped.slice(-50)}'`);
  });

  it('contains CREATE TABLE sectors', () => {
    assert.ok(/CREATE\s+TABLE\s+sectors\s*\(/i.test(sql), 'Missing CREATE TABLE sectors');
  });

  it('contains CREATE TABLE warps', () => {
    assert.ok(/CREATE\s+TABLE\s+warps\s*\(/i.test(sql), 'Missing CREATE TABLE warps');
  });

  it('contains CREATE TABLE ports', () => {
    assert.ok(/CREATE\s+TABLE\s+ports\s*\(/i.test(sql), 'Missing CREATE TABLE ports');
  });

  it('contains CREATE TABLE planets', () => {
    assert.ok(/CREATE\s+TABLE\s+planets\s*\(/i.test(sql), 'Missing CREATE TABLE planets');
  });

  it('contains \\copy statements for each table', () => {
    for (const table of ['sectors', 'warps', 'ports', 'planets']) {
      assert.ok(new RegExp(`\\\\copy\\s+${table}`, 'i').test(sql),
        `Missing \\copy statement for ${table}`);
    }
  });

  it('\\copy statements use relative paths', () => {
    const copyLines = sql.split('\n').filter(l => l.trim().toLowerCase().startsWith('\\copy'));
    for (const line of copyLines) {
      const m = /FROM\s+'([^']+)'/i.exec(line);
      if (m) {
        assert.ok(!m[1].startsWith('/'), `\\copy path should be relative, got: ${m[1]}`);
      }
    }
  });

  it('uses INTEGER for numeric columns', () => {
    const upper = sql.toUpperCase();
    assert.ok(upper.includes('INTEGER') || upper.includes('INT ') || upper.includes('INT,'),
      'SQL should use INTEGER for numeric columns');
  });

  it('uses VARCHAR or TEXT for string columns', () => {
    const upper = sql.toUpperCase();
    assert.ok(upper.includes('VARCHAR') || upper.includes('TEXT'),
      'SQL should use VARCHAR or TEXT for string columns');
  });
});

// ---------------------------------------------------------------------------
// CSV Formatting
// ---------------------------------------------------------------------------

describe('CSV Formatting', () => {
  let outdir;

  before(() => {
    outdir = generateUniverse({ sectors: 50, seed: 42, portDensity: 50, planetDensity: 20 });
  });
  after(() => { rmSync(outdir, { recursive: true, force: true }); });

  for (const fname of ['sectors.csv', 'warps.csv', 'ports.csv', 'planets.csv']) {
    it(`${fname} uses comma delimiters`, () => {
      const first = readFileSync(join(outdir, fname), 'utf8').split('\n')[0].trim();
      assert.ok(first.includes(','), `${fname} should use comma delimiters`);
    });
  }

  it('sectors.csv first line is "id,name"', () => {
    const first = readFileSync(join(outdir, 'sectors.csv'), 'utf8').split('\n')[0].trim();
    assert.equal(first, 'id,name');
  });

  it('warps.csv first line is "sector_from,sector_to"', () => {
    const first = readFileSync(join(outdir, 'warps.csv'), 'utf8').split('\n')[0].trim();
    assert.equal(first, 'sector_from,sector_to');
  });

  it('ports.csv first line is correct header', () => {
    const first = readFileSync(join(outdir, 'ports.csv'), 'utf8').split('\n')[0].trim();
    assert.equal(first, 'sector,class,fuel_qty,fuel_price,org_qty,org_price,equ_qty,equ_price');
  });

  it('planets.csv first line is "sector,planet_name,planet_type"', () => {
    const first = readFileSync(join(outdir, 'planets.csv'), 'utf8').split('\n')[0].trim();
    assert.equal(first, 'sector,planet_name,planet_type');
  });

  it('CSV files do not quote fields unless they contain a comma', () => {
    for (const fname of ['sectors.csv', 'warps.csv', 'ports.csv', 'planets.csv']) {
      const raw = readFileSync(join(outdir, fname), 'utf8');
      const lines = raw.trim().split('\n');
      for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        const quoted = [...line.matchAll(/"([^"]*)"/g)].map(m => m[1]);
        for (const field of quoted) {
          assert.ok(field.includes(','),
            `${fname} line ${lineNum + 1}: field '${field}' is quoted but contains no comma`);
        }
      }
    }
  });
});

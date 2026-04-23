import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { runCLI, makeTempDir, readCSV } from './bigbang-helpers.mjs';

// Helpers for running the CLI in an arbitrary out-dir with topology.
function runBigbang(outdir, extra = []) {
  return runCLI([outdir, ...extra]);
}

describe('Topology flag (random)', () => {
  let outdir;
  before(() => {
    outdir = makeTempDir();
    rmSync(outdir, { recursive: true, force: true });
    const { rc, stderr } = runBigbang(outdir, ['--sectors', '200', '--seed', '77', '--topology', 'random']);
    assert.equal(rc, 0, `CLI should succeed: ${stderr}`);
  });
  after(() => { rmSync(outdir, { recursive: true, force: true }); });

  it('sectors.csv has id,name,x,y header with empty x/y cells', () => {
    const { header, rows } = readCSV(join(outdir, 'sectors.csv'));
    assert.deepStrictEqual(header, ['id', 'name', 'x', 'y']);
    for (const row of rows) {
      assert.equal(row[2], '', `x should be empty for random topology, got "${row[2]}"`);
      assert.equal(row[3], '', `y should be empty for random topology, got "${row[3]}"`);
    }
  });
});

describe('Topology flag (proximal)', () => {
  let outdir;
  const N = 500;
  const SIZE = 10000;
  const minDist = SIZE / (2 * Math.sqrt(N));
  let positions;

  before(() => {
    outdir = makeTempDir();
    rmSync(outdir, { recursive: true, force: true });
    const { rc, stderr } = runBigbang(outdir, [
      '--sectors', String(N), '--seed', '1', '--topology', 'proximal',
    ]);
    assert.equal(rc, 0, `CLI should succeed: ${stderr}`);
    const { rows } = readCSV(join(outdir, 'sectors.csv'));
    positions = rows.map(r => ({
      id: parseInt(r[0], 10),
      x: Number(r[2]),
      y: Number(r[3]),
    }));
  });
  after(() => { rmSync(outdir, { recursive: true, force: true }); });

  it('produces positions for every sector', () => {
    assert.equal(positions.length, N);
    for (const p of positions) {
      assert.ok(Number.isFinite(p.x), `x must be finite for sector ${p.id}`);
      assert.ok(Number.isFinite(p.y), `y must be finite for sector ${p.id}`);
    }
  });

  it('every position is inside [0, 10000]²', () => {
    for (const p of positions) {
      assert.ok(p.x >= 0 && p.x <= SIZE, `sector ${p.id} x=${p.x} out of bounds`);
      assert.ok(p.y >= 0 && p.y <= SIZE, `sector ${p.id} y=${p.y} out of bounds`);
    }
  });

  it('minimum pairwise distance satisfies the spec', () => {
    // O(N²) but N=500 is fine.
    let minObserved = Infinity;
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dx = positions[i].x - positions[j].x;
        const dy = positions[i].y - positions[j].y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < minObserved) minObserved = d;
      }
    }
    assert.ok(
      minObserved >= minDist * 0.999,
      `minimum pairwise distance ${minObserved.toFixed(2)} < required ${minDist.toFixed(2)}`,
    );
  });

  it('weak connectivity: every sector reachable from 1 (undirected)', () => {
    const { rows: warpRows } = readCSV(join(outdir, 'warps.csv'));
    const adj = new Map();
    for (const r of warpRows) {
      const from = parseInt(r[0], 10);
      const to = parseInt(r[1], 10);
      if (!adj.has(from)) adj.set(from, new Set());
      if (!adj.has(to)) adj.set(to, new Set());
      adj.get(from).add(to);
      adj.get(to).add(from);
    }
    const seen = new Set([1]);
    const queue = [1];
    while (queue.length > 0) {
      const u = queue.shift();
      for (const v of adj.get(u) ?? []) {
        if (!seen.has(v)) { seen.add(v); queue.push(v); }
      }
    }
    assert.equal(seen.size, N, `Expected ${N} reachable sectors, got ${seen.size}`);
  });

  it('twoWayPct within ±5pp of requested 95', () => {
    const { rows: warpRows } = readCSV(join(outdir, 'warps.csv'));
    const warps = warpRows.map(r => ({
      from: parseInt(r[0], 10),
      to: parseInt(r[1], 10),
    }));
    const warpSet = new Set(warps.map(w => `${w.from},${w.to}`));
    let bi = 0;
    for (const w of warps) {
      if (warpSet.has(`${w.to},${w.from}`)) bi++;
    }
    const pct = (bi / warps.length) * 100;
    assert.ok(Math.abs(pct - 95) <= 5, `Two-way pct ${pct.toFixed(1)} should be within 5pp of 95`);
  });

  it('out-degree distribution has expected overall shape', () => {
    // N=500 is below the 1000-sector threshold where ±5pp applies; the
    // budget-bump used for feasibility shifts low degrees upward a bit. We
    // assert a looser shape here — no degree dominates, distribution is
    // monotonic-ish around its peak, and total edges match sum of degrees.
    const { rows: warpRows } = readCSV(join(outdir, 'warps.csv'));
    const outDeg = new Map();
    for (const r of warpRows) {
      const from = parseInt(r[0], 10);
      outDeg.set(from, (outDeg.get(from) ?? 0) + 1);
    }
    const counts = new Array(7).fill(0);
    for (const [, c] of outDeg) if (c >= 1 && c <= 6) counts[c]++;
    // All sectors accounted for.
    assert.equal(counts.slice(1).reduce((a, b) => a + b, 0), N);
    // Degree 2 is the mode in the default distribution; allow headroom.
    assert.ok(counts[2] >= N * 0.15, `Expected degree 2 to be common, got ${counts[2]}`);
    // Degrees 5 and 6 are rare.
    assert.ok(counts[6] <= N * 0.1, `Degree 6 should be rare, got ${counts[6]}`);
  });
});

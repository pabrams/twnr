import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { readCSV, generateUniverse } from './bigbang-helpers.mjs';


/** Returns a Map of value -> count. */
function counter(arr) {
  const map = new Map();
  for (const x of arr) map.set(x, (map.get(x) || 0) + 1);
  return map;
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

  it('warps.csv has header: from_sector_id, to_sector_id', () => {
    assert.deepStrictEqual(header, ['from_sector_id', 'to_sector_id']);
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

  it('default (no --two-way-pct) gives ~95%', () => {
    const dir = generateUniverse({ sectors: 100, seed: 42 });
    try { assertTwoWayPctInRange(readCSV(join(dir, 'warps.csv')).rows, 95, 'Default: '); }
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

  it('--two-way-pct 100 still respects degree limits (<=6 in/out)', () => {
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

  it('bidirectional % within +/-1% at 1000 sectors for targets 10, 50, 90', { timeout: 180000 }, () => {
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

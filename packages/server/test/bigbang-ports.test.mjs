import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { readCSV, generateUniverse } from './bigbang-helpers.mjs';

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
  let outdir, header, rows, starbaseSector;

  before(() => {
    outdir = generateUniverse({ sectors: NUM_SECTORS, seed: 42, portDensity: PORT_DENSITY, planetDensity: 10 });
    ({ header, rows } = readCSV(join(outdir, 'ports.csv')));
    const { rows: sRows } = readCSV(join(outdir, 'sectors.csv'));
    const starbaseRow = sRows.find(r => r[1] === 'Starbase');
    starbaseSector = starbaseRow ? parseInt(starbaseRow[0], 10) : null;
  });
  after(() => { rmSync(outdir, { recursive: true, force: true }); });

  it('ports.csv has correct header columns', () => {
    assert.deepStrictEqual(header, [
      'sector', 'class',
      'fuel_qty', 'fuel_max', 'fuel_prod', 'fuel_mcic',
      'org_qty', 'org_max', 'org_prod', 'org_mcic',
      'equ_qty', 'equ_max', 'equ_prod', 'equ_mcic',
    ]);
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

  it('Starbase sector has exactly one class 8 port', () => {
    assert.ok(starbaseSector != null, 'Starbase sector not found');
    const starbasePorts = rows.filter(r => parseInt(r[0], 10) === starbaseSector);
    assert.equal(starbasePorts.length, 1, 'Starbase must have exactly 1 port');
    assert.equal(parseInt(starbasePorts[0][1], 10), 8, 'Starbase port must be class 8');
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

  // Column layout: 0=sector, 1=class,
  // 2=fuel_qty, 3=fuel_max, 4=fuel_prod, 5=fuel_mcic,
  // 6=org_qty,  7=org_max,  8=org_prod,  9=org_mcic,
  // 10=equ_qty, 11=equ_max, 12=equ_prod, 13=equ_mcic
  const COMMODITY_OFFSETS = [
    { qty: 2,  max: 3,  prod: 4,  mcic: 5,  name: 'fuel',      mcicRange: [40, 90] },
    { qty: 6,  max: 7,  prod: 8,  mcic: 9,  name: 'organics',  mcicRange: [30, 75] },
    { qty: 10, max: 11, prod: 12, mcic: 13, name: 'equipment', mcicRange: [20, 65] },
  ];

  it('productivity is 60-280 and max = prod * 10', () => {
    for (const row of rows) {
      for (const c of COMMODITY_OFFSETS) {
        const prod = parseInt(row[c.prod], 10);
        const max = parseInt(row[c.max], 10);
        assert.ok(prod >= 60 && prod <= 280, `Sector ${row[0]} ${c.name}: prod ${prod} out of [60,280]`);
        assert.equal(max, prod * 10, `Sector ${row[0]} ${c.name}: max ${max} != prod*10 ${prod * 10}`);
      }
    }
  });

  it('initial stock matches physical-stock model: selling spawns full, buying spawns empty', () => {
    for (const row of rows) {
      const pc = parseInt(row[1], 10);
      const bsa = PORT_CLASSES[pc];
      for (let i = 0; i < COMMODITY_OFFSETS.length; i++) {
        const c = COMMODITY_OFFSETS[i];
        const qty = parseInt(row[c.qty], 10);
        const max = parseInt(row[c.max], 10);
        if (bsa[i] === 'S') {
          assert.equal(qty, max, `Sector ${row[0]} ${c.name} (S): selling port should spawn full, got qty=${qty} vs max=${max}`);
        } else {
          assert.equal(qty, 0, `Sector ${row[0]} ${c.name} (B): buying port should spawn empty, got qty=${qty}`);
        }
      }
    }
  });

  it('MCIC sign matches port class action and magnitude is in commodity range', () => {
    for (const row of rows) {
      const pc = parseInt(row[1], 10);
      const bsa = PORT_CLASSES[pc];
      for (let i = 0; i < COMMODITY_OFFSETS.length; i++) {
        const c = COMMODITY_OFFSETS[i];
        const mcic = parseInt(row[c.mcic], 10);
        const mag = Math.abs(mcic);
        assert.ok(mag >= c.mcicRange[0] && mag <= c.mcicRange[1],
          `Sector ${row[0]} ${c.name}: |MCIC| ${mag} not in [${c.mcicRange[0]},${c.mcicRange[1]}]`);
        if (bsa[i] === 'B') {
          assert.ok(mcic < 0, `Sector ${row[0]} class ${pc} ${c.name}: B-action MCIC must be negative, got ${mcic}`);
        } else {
          assert.ok(mcic > 0, `Sector ${row[0]} class ${pc} ${c.name}: S-action MCIC must be positive, got ${mcic}`);
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

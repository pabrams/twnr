import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { readCSV, generateUniverse } from './bigbang-helpers.mjs';


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

  it('warps.csv first line is "from_sector_id,to_sector_id"', () => {
    const first = readFileSync(join(outdir, 'warps.csv'), 'utf8').split('\n')[0].trim();
    assert.equal(first, 'from_sector_id,to_sector_id');
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

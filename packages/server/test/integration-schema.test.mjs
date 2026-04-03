import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  createPool,
  startServer,
  testEnv,
} from './helpers.mjs';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = join(dirname(__filename), '..');

let pool;
let serverProc;

before(async () => {
  const universeDir = mkdtempSync(join(tmpdir(), 'twnr_test_universe_'));
  try {
    rmSync(universeDir, { recursive: true, force: true });
    const gen = spawnSync(process.execPath, [
      join(PROJECT_ROOT, 'scripts', 'twnr-bigbang.js'),
      universeDir, '--sectors', '100', '--seed', '42',
    ], { encoding: 'utf8', cwd: PROJECT_ROOT });
    if (gen.status !== 0) throw new Error(`bigbang failed: ${gen.stderr}`);

    pool = createPool();
    await pool.query('SELECT 1');
    await pool.query('DROP TABLE IF EXISTS planets, visited_sectors, ship_cargo, player_ships, ports, warps, players, sectors, universes, users CASCADE');
    await pool.end();

    const imp = spawnSync(process.execPath, [
      join(PROJECT_ROOT, 'scripts', 'importUniverse.js'),
      universeDir, '--force',
    ], { encoding: 'utf8', cwd: PROJECT_ROOT, env: testEnv() });
    if (imp.status !== 0) throw new Error(`importUniverse failed: ${imp.stderr}`);

    serverProc = await startServer();
  } finally {
    rmSync(universeDir, { recursive: true, force: true });
  }

  pool = createPool();
});

after(async () => {
  if (serverProc) serverProc.kill();
  if (pool) await pool.end();
});

describe('Schema', () => {
  it('sectors table has an integer id column', async () => {
    const res = await pool.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = 'sectors' AND column_name = 'id'`
    );
    assert.equal(res.rows.length, 1, 'sectors table should have an id column');
    assert.ok(res.rows[0].data_type.includes('int'), 'id should be an integer type');
  });

  it('warps table has sector_from and sector_to columns', async () => {
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'warps' ORDER BY column_name`
    );
    const cols = res.rows.map(r => r.column_name);
    assert.ok(cols.includes('sector_from'), 'missing sector_from column');
    assert.ok(cols.includes('sector_to'), 'missing sector_to column');
  });

  it('players table has id, name, and current_sector columns', async () => {
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'players' ORDER BY column_name`
    );
    const cols = res.rows.map(r => r.column_name);
    assert.ok(cols.includes('id'), 'missing id column');
    assert.ok(cols.includes('name'), 'missing name column');
    assert.ok(cols.includes('current_sector'), 'missing current_sector column');
  });

  it('warps table has foreign key referencing universes', async () => {
    const res = await pool.query(
      `SELECT ccu.table_name AS foreign_table, kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
       WHERE tc.table_name = 'warps' AND tc.constraint_type = 'FOREIGN KEY'`
    );
    const fkTables = res.rows.map(r => r.foreign_table);
    assert.ok(fkTables.includes('universes'), 'warps should have FK to universes');
  });

  it('players table has foreign keys referencing users and universes', async () => {
    const res = await pool.query(
      `SELECT kcu.column_name, ccu.table_name AS foreign_table
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
       WHERE tc.table_name = 'players' AND tc.constraint_type = 'FOREIGN KEY'`
    );
    const fkTables = res.rows.map(r => r.foreign_table);
    assert.ok(fkTables.includes('users'), 'players should have FK to users');
    assert.ok(fkTables.includes('universes'), 'players should have FK to universes');
  });
});

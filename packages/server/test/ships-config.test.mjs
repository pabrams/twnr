import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPool, startServer, testEnv } from './helpers.mjs';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = join(dirname(__filename), '..');

// ─── globals ──────────────────────────────────────────────────────────────────

let pool;
let serverProc;

// ─── setup ────────────────────────────────────────────────────────────────────

before(async () => {
  const universeDir = join(tmpdir(), `twnr_ships_test_${Date.now()}`);

  const gen = spawnSync(process.execPath, [
    join(PROJECT_ROOT, 'scripts', 'twnr-bigbang.js'),
    universeDir, '--sectors', '100', '--seed', '42',
  ], { encoding: 'utf8', cwd: PROJECT_ROOT });
  if (gen.status !== 0) throw new Error(`bigbang failed: ${gen.stderr}`);

  pool = createPool();
  await pool.query('SELECT 1');
  await pool.query(`
    DROP TABLE IF EXISTS player_ships CASCADE;
    DROP TABLE IF EXISTS ship_cargo CASCADE;
    DROP TABLE IF EXISTS ports CASCADE;
    DROP TABLE IF EXISTS warps CASCADE;
    DROP TABLE IF EXISTS players CASCADE;
    DROP TABLE IF EXISTS sectors CASCADE;
    DROP TABLE IF EXISTS universes CASCADE;
    DROP TABLE IF EXISTS users CASCADE;
  `);
  await pool.end();

  const imp = spawnSync(process.execPath, [
    join(PROJECT_ROOT, 'scripts', 'importUniverse.js'),
    universeDir, '--force',
  ], { encoding: 'utf8', cwd: PROJECT_ROOT, env: testEnv() });
  if (imp.status !== 0) throw new Error(`importUniverse failed: ${imp.stderr}\n${imp.stdout}`);

  serverProc = await startServer();
  pool = createPool();
});

after(async () => {
  if (serverProc) serverProc.kill();
  if (pool) await pool.end();
});

// ─── tests ────────────────────────────────────────────────────────────────────

describe('Config Files', () => {
  it('config/ships/merchant.json exists', () => {
    const p = join(PROJECT_ROOT, 'config', 'ships', 'merchant.json');
    assert.ok(existsSync(p), 'merchant.json should exist at config/ships/merchant.json');
  });

  it('merchant.json has correct fields and values', () => {
    const p = join(PROJECT_ROOT, 'config', 'ships', 'merchant.json');
    assert.ok(existsSync(p), 'merchant.json must exist');
    const cfg = JSON.parse(readFileSync(p, 'utf8'));
    assert.equal(cfg.name, 'Merchant Freighter');
    assert.equal(cfg.maxFighters, 10);
    assert.equal(cfg.maxShields, 10);
    assert.equal(cfg.startingHolds, 5, 'startingHolds should be 5');
    assert.equal(cfg.maxHolds, 20, 'maxHolds (cap) should be 20');
    assert.equal(cfg.price, 5000);
  });

  it('config/ships/warbird.json exists', () => {
    const p = join(PROJECT_ROOT, 'config', 'ships', 'warbird.json');
    assert.ok(existsSync(p), 'warbird.json should exist at config/ships/warbird.json');
  });

  it('warbird.json has correct fields and values', () => {
    const p = join(PROJECT_ROOT, 'config', 'ships', 'warbird.json');
    assert.ok(existsSync(p), 'warbird.json must exist');
    const cfg = JSON.parse(readFileSync(p, 'utf8'));
    assert.equal(cfg.name, 'Warbird');
    assert.equal(cfg.maxFighters, 30);
    assert.equal(cfg.maxShields, 25);
    assert.equal(cfg.startingHolds, 1, 'startingHolds should be 1');
    assert.equal(cfg.maxHolds, 5, 'maxHolds (cap) should be 5');
    assert.equal(cfg.price, 8000);
  });
});

describe('Database Schema', () => {
  it('player_ships table exists', async () => {
    const res = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'player_ships'`
    );
    assert.equal(res.rows.length, 1, 'player_ships table should exist');
  });

  it('player_ships has required columns including cargo_limit', async () => {
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'player_ships' ORDER BY column_name`
    );
    const cols = res.rows.map(r => r.column_name);
    assert.ok(cols.includes('player_id'), 'should have player_id');
    assert.ok(cols.includes('ship_name'), 'should have ship_name');
    assert.ok(cols.includes('fighters'), 'should have fighters');
    assert.ok(cols.includes('shields'), 'should have shields');
    assert.ok(cols.includes('cargo_limit'), 'should have cargo_limit (not max_holds)');
  });
});

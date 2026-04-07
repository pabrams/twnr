import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureServer, createPool } from './global-setup.mjs';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = join(dirname(__filename), '..');

// ─── globals ──────────────────────────────────────────────────────────────────

let pool;

// ─── setup ────────────────────────────────────────────────────────────────────

before(async () => {
  await ensureServer();
  pool = createPool();
});

after(async () => {
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
    assert.equal(cfg.maxDrones, 10);
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
    assert.equal(cfg.maxDrones, 30);
    assert.equal(cfg.maxShields, 25);
    assert.equal(cfg.startingHolds, 1, 'startingHolds should be 1');
    assert.equal(cfg.maxHolds, 5, 'maxHolds (cap) should be 5');
    assert.equal(cfg.price, 8000);
  });
});

describe('Database Schema', () => {
  it('ships table exists', async () => {
    const res = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'ships'`
    );
    assert.equal(res.rows.length, 1, 'ships table should exist');
  });

  it('ships has required columns including holds', async () => {
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'ships' ORDER BY column_name`
    );
    const cols = res.rows.map(r => r.column_name);
    assert.ok(cols.includes('owner_id'), 'should have owner_id');
    assert.ok(cols.includes('ship_type_id'), 'should have ship_type_id');
    assert.ok(cols.includes('drones'), 'should have drones');
    assert.ok(cols.includes('shields'), 'should have shields');
    assert.ok(cols.includes('holds'), 'should have holds (not cargo_limit)');
  });

  it('ship_types table exists', async () => {
    const res = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'ship_types'`
    );
    assert.equal(res.rows.length, 1, 'ship_types table should exist');
  });
});

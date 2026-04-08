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
  it('config/ships/01-vulpeculan-cruiser.json exists', () => {
    const p = join(PROJECT_ROOT, 'config', 'ships', '01-vulpeculan-cruiser.json');
    assert.ok(existsSync(p), '01-vulpeculan-cruiser.json should exist at config/ships/');
  });

  it('vulpeculan-cruiser.json has correct fields and values', () => {
    const p = join(PROJECT_ROOT, 'config', 'ships', '01-vulpeculan-cruiser.json');
    assert.ok(existsSync(p), '01-vulpeculan-cruiser.json must exist');
    const cfg = JSON.parse(readFileSync(p, 'utf8'));
    assert.equal(cfg.name, 'Vulpeculan Cruiser');
    assert.equal(cfg.maxDrones, 2500);
    assert.equal(cfg.maxShields, 400);
    assert.equal(cfg.startingHolds, 20, 'startingHolds should be 20');
    assert.equal(cfg.maxHolds, 75, 'maxHolds (cap) should be 75');
    // price is now calculated as costDrive + costComputer + costHull + holdCost
    const expectedPrice = cfg.costDrive + cfg.costComputer + cfg.costHull + cfg.holdCost;
    assert.equal(expectedPrice, 41300);
  });

  it('config/ships/02-hydra-skiff.json exists', () => {
    const p = join(PROJECT_ROOT, 'config', 'ships', '02-hydra-skiff.json');
    assert.ok(existsSync(p), '02-hydra-skiff.json should exist at config/ships/');
  });

  it('hydra-skiff.json has correct fields and values', () => {
    const p = join(PROJECT_ROOT, 'config', 'ships', '02-hydra-skiff.json');
    assert.ok(existsSync(p), '02-hydra-skiff.json must exist');
    const cfg = JSON.parse(readFileSync(p, 'utf8'));
    assert.equal(cfg.name, 'Hydra Skiff');
    assert.equal(cfg.maxDrones, 250);
    assert.equal(cfg.maxShields, 100);
    assert.equal(cfg.startingHolds, 10, 'startingHolds should be 10');
    assert.equal(cfg.maxHolds, 25, 'maxHolds (cap) should be 25');
    // price is now calculated as costDrive + costComputer + costHull + holdCost
    const expectedPrice = cfg.costDrive + cfg.costComputer + cfg.costHull + cfg.holdCost;
    assert.equal(expectedPrice, 15950);
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

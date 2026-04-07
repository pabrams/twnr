import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { ensureServer, createPool as _gsCreatePool } from './global-setup.mjs';

const { Pool } = pg;
const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
const BASE = 'http://localhost:3000';

// ─── Helpers ────────────────────────────────────────────────────────────────

// ─── Setup ──────────────────────────────────────────────────────────────────

let pool;

before(async () => {
  await ensureServer();
  pool = _gsCreatePool();
});

after(async () => {
  if (pool) await pool.end();
});

// ─── 1. Users table ─────────────────────────────────────────────────────────

describe('Users table schema', () => {
  it('users table exists with required columns', async () => {
    const res = await pool.query(`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'users'
      ORDER BY ordinal_position
    `);
    const cols = res.rows.map(r => r.column_name);
    assert.ok(cols.includes('id'), 'users table should have id column');
    assert.ok(cols.includes('email'), 'users table should have email column');
    assert.ok(cols.includes('password_hash'), 'users table should have password_hash column');
    assert.ok(cols.includes('role'), 'users table should have role column');
    assert.ok(cols.includes('token_version'), 'users table should have token_version column');
  });

  it('users.email has a unique constraint', async () => {
    const res = await pool.query(`
      SELECT constraint_type FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
      WHERE tc.table_name = 'users' AND ccu.column_name = 'email' AND tc.constraint_type = 'UNIQUE'
    `);
    assert.ok(res.rows.length > 0, 'email column should have a unique constraint');
  });
});

// ─── 2. Universes table ─────────────────────────────────────────────────────

describe('Universes table schema', () => {
  it('universes table exists with required columns', async () => {
    const res = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'universes'
      ORDER BY ordinal_position
    `);
    const cols = res.rows.map(r => r.column_name);
    assert.ok(cols.includes('id'), 'universes table should have id column');
    assert.ok(cols.includes('name'), 'universes table should have name column');
    assert.ok(cols.includes('seed'), 'universes table should have seed column');
    assert.ok(cols.includes('created_at'), 'universes table should have created_at column');
  });
});

// ─── 3. Players table modifications ─────────────────────────────────────────

describe('Players table modifications', () => {
  it('players table has user_id column', async () => {
    const res = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'players' AND column_name = 'user_id'
    `);
    assert.equal(res.rows.length, 1, 'players table should have user_id column');
  });

  it('players table has universe_id column', async () => {
    const res = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'players' AND column_name = 'universe_id'
    `);
    assert.equal(res.rows.length, 1, 'players table should have universe_id column');
  });

  it('players table does not have email column', async () => {
    const res = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'players' AND column_name = 'email'
    `);
    assert.equal(res.rows.length, 0, 'players table should NOT have email column');
  });

  it('players table does not have password_hash column', async () => {
    const res = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'players' AND column_name = 'password_hash'
    `);
    assert.equal(res.rows.length, 0, 'players table should NOT have password_hash column');
  });

  it('players table does not have role column', async () => {
    const res = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'players' AND column_name = 'role'
    `);
    assert.equal(res.rows.length, 0, 'players table should NOT have role column');
  });

  it('players table does not have token_version column', async () => {
    const res = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'players' AND column_name = 'token_version'
    `);
    assert.equal(res.rows.length, 0, 'players table should NOT have token_version column');
  });

  it('players has unique constraint on (user_id, universe_id)', async () => {
    const res = await pool.query(`
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
      WHERE tc.table_name = 'players' AND tc.constraint_type = 'UNIQUE'
      GROUP BY tc.constraint_name
      HAVING array_agg(ccu.column_name::text ORDER BY ccu.column_name) @> ARRAY['universe_id', 'user_id']
    `);
    assert.ok(res.rows.length > 0, 'players should have unique constraint on (user_id, universe_id)');
  });
});

// ─── 4. Universe-scoped tables ──────────────────────────────────────────────

describe('Universe-scoped tables', () => {
  it('sectors table has universe_id column', async () => {
    const res = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'sectors' AND column_name = 'universe_id'
    `);
    assert.equal(res.rows.length, 1, 'sectors should have universe_id column');
  });

  it('sectors table has sector_number column', async () => {
    const res = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'sectors' AND column_name = 'sector_number'
    `);
    assert.equal(res.rows.length, 1, 'sectors should have sector_number column');
  });

  it('sectors primary key is id only (SERIAL)', async () => {
    const res = await pool.query(`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_name = 'sectors' AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY kcu.ordinal_position
    `);
    const pkCols = res.rows.map(r => r.column_name);
    assert.deepEqual(pkCols, ['id'], 'sectors PK should be id only');
  });

  it('sectors has unique constraint on (universe_id, sector_number)', async () => {
    const res = await pool.query(`
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
      WHERE tc.table_name = 'sectors' AND tc.constraint_type = 'UNIQUE'
      GROUP BY tc.constraint_name
      HAVING array_agg(ccu.column_name::text ORDER BY ccu.column_name) @> ARRAY['sector_number', 'universe_id']
    `);
    assert.ok(res.rows.length > 0, 'sectors should have unique constraint on (universe_id, sector_number)');
  });

  it('warps table does NOT have universe_id column', async () => {
    const res = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'warps' AND column_name = 'universe_id'
    `);
    assert.equal(res.rows.length, 0, 'warps should NOT have universe_id column');
  });

  it('warps primary key is (from_sector_id, to_sector_id)', async () => {
    const res = await pool.query(`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_name = 'warps' AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY kcu.ordinal_position
    `);
    const pkCols = res.rows.map(r => r.column_name);
    assert.ok(pkCols.includes('from_sector_id'), 'warps PK should include from_sector_id');
    assert.ok(pkCols.includes('to_sector_id'), 'warps PK should include to_sector_id');
    assert.equal(pkCols.length, 2, 'warps PK should have exactly 2 columns');
  });

  it('ports table does NOT have universe_id column', async () => {
    const res = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'ports' AND column_name = 'universe_id'
    `);
    assert.equal(res.rows.length, 0, 'ports should NOT have universe_id column');
  });

  it('ports has unique constraint on sector_id', async () => {
    const res = await pool.query(`
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
      WHERE tc.table_name = 'ports' AND tc.constraint_type = 'UNIQUE'
        AND ccu.column_name = 'sector_id'
    `);
    assert.ok(res.rows.length > 0, 'ports should have unique constraint on sector_id');
  });
});

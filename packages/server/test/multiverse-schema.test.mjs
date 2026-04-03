import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const { Pool } = pg;
const SERVER_DIR = process.cwd();
const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
const BASE = 'http://localhost:3000';

// ─── Helpers ────────────────────────────────────────────────────────────────

function createPool() {
  return new Pool({
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'twnr_test',
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
  });
}

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['dist/server.js'], {
      cwd: SERVER_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PGDATABASE: process.env.PGDATABASE || 'twnr_test',
        JWT_SECRET,
        ADMIN_API_KEY: process.env.ADMIN_API_KEY || 'test-admin-key',
        WS_ALLOWED_ORIGINS: process.env.WS_ALLOWED_ORIGINS || 'http://localhost:3000',
      },
    });

    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error('Server start timeout (15s)')); }
    }, 15000);

    proc.stdout.on('data', (d) => {
      const out = d.toString();
      if (!settled && (out.includes('listening') || out.includes('3000'))) {
        settled = true;
        clearTimeout(timeout);
        setTimeout(() => resolve(proc), 3000);
      }
    });

    proc.stderr.on('data', (d) => {
      const text = d.toString().trim();
      if (text) process.stderr.write(`[server stderr] ${text}\n`);
    });

    proc.on('error', (err) => {
      if (!settled) { settled = true; clearTimeout(timeout); reject(err); }
    });
    proc.on('exit', (code) => {
      if (!settled) { settled = true; clearTimeout(timeout); reject(new Error(`Server exited with code ${code}`)); }
    });
  });
}

// ─── Setup ──────────────────────────────────────────────────────────────────

let pool;
let serverProc;

before(async () => {
  pool = createPool();
  await pool.query('SELECT 1');
  // Drop all tables to start fresh
  await pool.query(`
    DROP TABLE IF EXISTS ship_cargo CASCADE;
    DROP TABLE IF EXISTS player_ships CASCADE;
    DROP TABLE IF EXISTS ports CASCADE;
    DROP TABLE IF EXISTS warps CASCADE;
    DROP TABLE IF EXISTS players CASCADE;
    DROP TABLE IF EXISTS sectors CASCADE;
    DROP TABLE IF EXISTS universes CASCADE;
    DROP TABLE IF EXISTS users CASCADE;
  `);
  await pool.end();

  // Server should start with empty database (no sectors required)
  serverProc = await startServer();

  pool = createPool();
});

after(async () => {
  if (serverProc) serverProc.kill();
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

  it('warps table has universe_id column', async () => {
    const res = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'warps' AND column_name = 'universe_id'
    `);
    assert.equal(res.rows.length, 1, 'warps should have universe_id column');
  });

  it('ports table has universe_id column', async () => {
    const res = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'ports' AND column_name = 'universe_id'
    `);
    assert.equal(res.rows.length, 1, 'ports should have universe_id column');
  });

  it('sectors primary key includes universe_id', async () => {
    const res = await pool.query(`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_name = 'sectors' AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY kcu.ordinal_position
    `);
    const pkCols = res.rows.map(r => r.column_name);
    assert.ok(pkCols.includes('id'), 'sectors PK should include id');
    assert.ok(pkCols.includes('universe_id'), 'sectors PK should include universe_id');
  });

  it('warps primary key includes universe_id', async () => {
    const res = await pool.query(`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_name = 'warps' AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY kcu.ordinal_position
    `);
    const pkCols = res.rows.map(r => r.column_name);
    assert.ok(pkCols.includes('universe_id'), 'warps PK should include universe_id');
  });

  it('ports has unique constraint on (sector_id, universe_id)', async () => {
    const res = await pool.query(`
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
      WHERE tc.table_name = 'ports' AND tc.constraint_type = 'UNIQUE'
      GROUP BY tc.constraint_name
      HAVING array_agg(ccu.column_name::text ORDER BY ccu.column_name) @> ARRAY['sector_id', 'universe_id']
    `);
    assert.ok(res.rows.length > 0, 'ports should have unique constraint on (sector_id, universe_id)');
  });
});

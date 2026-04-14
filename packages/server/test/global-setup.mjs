/**
 * Shared test infrastructure.
 *
 * When running via `test/run-tests.sh`, the server is already running.
 * When running a single test file directly, `ensureServer()` starts one.
 *
 * Call `await ensureServer()` in your top-level `before()` hook.
 * Each test file should create its own pool via `createPool()`.
 */

import pg from 'pg';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { spawn, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = join(dirname(__filename), '..');

export const JWT_SECRET = 'test-jwt-secret';
export const ADMIN_API_KEY = 'test-admin-key';
export const TEST_DB = process.env.PGDATABASE || 'twnr_test';
export const TEST_PORT = process.env.PORT || '3000';
export const BASE = `http://localhost:${TEST_PORT}`;
export const WS_BASE = `ws://localhost:${TEST_PORT}`;

export function testEnv() {
  return { ...process.env, PGDATABASE: TEST_DB };
}

export function createPool() {
  return new Pool({
    host: process.env.PGHOST || 'localhost',
    database: TEST_DB,
    user: process.env.PGUSER || 'twnr_user',
    password: process.env.PGPASSWORD || 'twnr_pass',
  });
}

// ─── shared auth helpers ─────────────────────────────────────────────────────

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${derivedKey.toString('base64url')}`;
}

/**
 * Creates a test user in the DB and returns { userId, token }.
 * If name/email are omitted, they are auto-generated.
 */
export async function createTestUserWithToken(pool, { name, email, password = 'testpass', role = 'player' } = {}) {
  const ts = Date.now() + Math.random();
  const actualName = name ?? `TestUser_${ts}`;
  const actualEmail = email ?? `testuser_${ts}@test.com`;
  const hash = hashPassword(password);
  const res = await pool.query(
    `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, role, token_version`,
    [actualEmail, hash, role],
  );
  const user = res.rows[0];
  const token = jwt.sign(
    { userId: user.id, name: actualName, role: user.role, tokenVersion: user.token_version },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '7d' },
  );
  return { userId: user.id, token };
}

// ─── singleton state ─────────────────────────────────────────────────────────

let serverProc = null;
let setupPromise = null;

async function isServerRunning() {
  try {
    const res = await fetch(`${BASE}/api/ships`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['dist/server.js'], {
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PGDATABASE: TEST_DB,
        PGUSER: process.env.PGUSER || 'twnr_user',
        PGPASSWORD: process.env.PGPASSWORD || 'twnr_pass',
        JWT_SECRET,
        ADMIN_API_KEY,
        WS_ALLOWED_ORIGINS: BASE,
      },
    });

    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error('Server start timeout (15s)')); }
    }, 15000);

    let stdout = '';
    proc.stdout.on('data', (d) => {
      stdout += d.toString();
      if (!settled && (stdout.includes('listening') || stdout.includes(TEST_PORT))) {
        settled = true;
        clearTimeout(timeout);
        // Detach stdio so the test process can exit when tests finish
        proc.stdout.removeAllListeners('data');
        proc.stderr.removeAllListeners('data');
        proc.stdout.destroy();
        proc.stderr.destroy();
        proc.stdin.destroy();
        proc.unref();
        setTimeout(() => resolve(proc), 5000);
      }
    });

    proc.stderr.on('data', (d) => {
      const text = d.toString().trim();
      if (text) process.stderr.write(`[server] ${text}\n`);
    });

    proc.on('error', (err) => {
      if (!settled) { settled = true; clearTimeout(timeout); reject(err); }
    });
    proc.on('exit', (code) => {
      if (!settled) { settled = true; clearTimeout(timeout); reject(new Error(`Server exited with code ${code}`)); }
    });
  });
}

async function doSetup() {
  // If server is already running (e.g. from run-tests.sh), just use it
  if (await isServerRunning()) {
    return;
  }

  // Full setup: bigbang → drop → import → start server
  const universeDir = join(tmpdir(), `twnr_test_${Date.now()}`);

  const gen = spawnSync(process.execPath, [
    join(PROJECT_ROOT, 'scripts', 'twnr-bigbang.js'),
    universeDir, '--sectors', '100', '--seed', '42',
  ], { encoding: 'utf8', cwd: PROJECT_ROOT });
  if (gen.status !== 0) throw new Error(`bigbang failed: ${gen.stderr}`);

  let pool = createPool();
  await pool.query('SELECT 1');
  await pool.query(`
    DROP TABLE IF EXISTS menu_command CASCADE;
    DROP TABLE IF EXISTS command CASCADE;
    DROP TABLE IF EXISTS sector_drones CASCADE;
    DROP TABLE IF EXISTS planet_collisions CASCADE;
    DROP TABLE IF EXISTS planets CASCADE;
    DROP TABLE IF EXISTS visited_sectors CASCADE;
    DROP TABLE IF EXISTS ship_hardware CASCADE;
    DROP TABLE IF EXISTS ships CASCADE;
    DROP TABLE IF EXISTS ship_type_hardware CASCADE;
    DROP TABLE IF EXISTS ship_types_edits CASCADE;
    DROP TABLE IF EXISTS planet_types_edits CASCADE;
    DROP TABLE IF EXISTS ship_types CASCADE;
    DROP TABLE IF EXISTS hardware_price CASCADE;
    DROP TABLE IF EXISTS hardware_item CASCADE;
    DROP TABLE IF EXISTS ports CASCADE;
    DROP TABLE IF EXISTS warps CASCADE;
    DROP TABLE IF EXISTS players CASCADE;
    DROP TABLE IF EXISTS sectors CASCADE;
    DROP TABLE IF EXISTS universes CASCADE;
    DROP TABLE IF EXISTS edits CASCADE;
    DROP TABLE IF EXISTS users CASCADE;
    DROP TABLE IF EXISTS menu CASCADE;
  `);
  await pool.end();

  const imp = spawnSync(process.execPath, [
    join(PROJECT_ROOT, 'scripts', 'importUniverse.js'),
    universeDir, '--force',
  ], { encoding: 'utf8', cwd: PROJECT_ROOT, env: { ...testEnv(), PGUSER: 'twnr_user', PGPASSWORD: 'twnr_pass' } });
  if (imp.status !== 0) throw new Error(`importUniverse failed: ${imp.stderr}\n${imp.stdout}`);

  serverProc = await startServer();

  // Sync sequences so direct INSERTs don't collide with imported IDs
  pool = createPool();
  await pool.query("SELECT setval('universes_id_seq', COALESCE((SELECT MAX(id) FROM universes), 0) + 1)");
  await pool.end();
}

/**
 * Ensures the test server is running. Safe to call from every test file —
 * only the first call does actual work; subsequent calls are instant.
 */
export async function ensureServer() {
  if (!setupPromise) {
    setupPromise = doSetup();
    process.on('exit', () => { if (serverProc) serverProc.kill(); });
  }
  return setupPromise;
}

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn, execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${derivedKey.toString('base64url')}`;
}

async function createTestUser(name, email, password) {
  const hash = hashPassword(password);
  const res = await pool.query(
    `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'player') RETURNING id, role, token_version`,
    [email, hash],
  );
  const user = res.rows[0];
  const token = jwt.sign(
    { userId: user.id, name, role: user.role, tokenVersion: user.token_version },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '7d' },
  );
  return { status: 201, body: { userId: user.id }, token };
}

async function createUniverse(token, name) {
  const res = await fetch(`${BASE}/api/universes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `twnr_auth=${token}`,
    },
    body: JSON.stringify({ name }),
  });
  return { status: res.status, body: await res.json() };
}

// ─── Setup ──────────────────────────────────────────────────────────────────

let pool;
let serverProc;

before(async () => {
  pool = createPool();
  await pool.query('SELECT 1');
  await pool.query(`
    DROP TABLE IF EXISTS ship_cargo CASCADE;
    DROP TABLE IF EXISTS planets CASCADE;
    DROP TABLE IF EXISTS visited_sectors CASCADE;
    DROP TABLE IF EXISTS player_ships CASCADE;
    DROP TABLE IF EXISTS ports CASCADE;
    DROP TABLE IF EXISTS warps CASCADE;
    DROP TABLE IF EXISTS players CASCADE;
    DROP TABLE IF EXISTS sectors CASCADE;
    DROP TABLE IF EXISTS universes CASCADE;
    DROP TABLE IF EXISTS users CASCADE;
  `);
  await pool.end();

  serverProc = await startServer();

  pool = createPool();
});

after(async () => {
  if (serverProc) serverProc.kill();
  if (pool) await pool.end();
});

// ─── 9. importUniverse.js --universe-id flag ────────────────────────────────

describe('importUniverse.js --universe-id flag', () => {
  it('imports sectors with the specified universe_id', async () => {
    // Create a temporary bigbang output directory with minimal CSV data
    const tmpDir = mkdtempSync(join(tmpdir(), 'twnr-import-test-'));

    writeFileSync(join(tmpDir, 'sectors.csv'), 'id,name\n1,Federation Space\n2,Sector 2\n');
    writeFileSync(join(tmpDir, 'warps.csv'), 'from,to\n1,2\n2,1\n');
    writeFileSync(join(tmpDir, 'ports.csv'), 'sector,class,fuel,fuel_price,organics,org_price,equipment,equ_price\n2,1,500,10,500,10,500,10\n');

    // Create a universe to import into
    const ts = Date.now();
    const reg = await createTestUser(`import_${ts}`, `import_${ts}@test.com`, 'pass123');
    const univ = await createUniverse(reg.token, `ImportTest ${ts}`);
    const uid = univ.body.universeId;

    // Run importUniverse.js with --universe-id
    const env = {
      ...process.env,
      PGHOST: process.env.PGHOST || 'localhost',
      PGDATABASE: process.env.PGDATABASE || 'twnr_test',
      PGUSER: process.env.PGUSER,
      PGPASSWORD: process.env.PGPASSWORD,
    };

    const result = execSync(
      `node ${SERVER_DIR}/scripts/importUniverse.js ${tmpDir} --force --universe-id ${uid}`,
      { env, timeout: 15000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );

    // Verify sectors were imported with the correct universe_id
    const sectorRes = await pool.query(
      'SELECT id, universe_id FROM sectors WHERE universe_id = $1 ORDER BY id',
      [uid],
    );
    assert.ok(sectorRes.rows.length >= 2, `Should have imported at least 2 sectors for universe ${uid}`);
    for (const row of sectorRes.rows) {
      assert.equal(row.universe_id, uid, `Sector should have universe_id = ${uid}`);
    }

    // Verify warps were imported with the correct universe_id
    const warpRes = await pool.query(
      'SELECT universe_id FROM warps WHERE universe_id = $1',
      [uid],
    );
    assert.ok(warpRes.rows.length >= 2, 'Should have imported warps');

    // Verify ports were imported with the correct universe_id
    const portRes = await pool.query(
      'SELECT universe_id FROM ports WHERE universe_id = $1',
      [uid],
    );
    assert.ok(portRes.rows.length >= 1, 'Should have imported ports');
  });

  it('defaults to universe_id=1 when --universe-id is not provided', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'twnr-import-default-'));
    writeFileSync(join(tmpDir, 'sectors.csv'), 'id,name\n1,Federation Space\n2,Sector 2\n');
    writeFileSync(join(tmpDir, 'warps.csv'), 'from,to\n1,2\n2,1\n');
    writeFileSync(join(tmpDir, 'ports.csv'), 'sector,class,fuel,fuel_price,organics,org_price,equipment,equ_price\n2,1,500,10,500,10,500,10\n');

    const env = {
      ...process.env,
      PGHOST: process.env.PGHOST || 'localhost',
      PGDATABASE: process.env.PGDATABASE || 'twnr_test',
      PGUSER: process.env.PGUSER,
      PGPASSWORD: process.env.PGPASSWORD,
    };

    // Ensure universe_id=1 exists
    await pool.query(
      'INSERT INTO universes (id, name) VALUES (1, $1) ON CONFLICT (id) DO NOTHING',
      ['Default Universe'],
    );

    execSync(
      `node ${SERVER_DIR}/scripts/importUniverse.js ${tmpDir} --force`,
      { env, timeout: 15000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );

    const sectorRes = await pool.query(
      'SELECT id, universe_id FROM sectors WHERE universe_id = 1 ORDER BY id',
    );
    assert.ok(sectorRes.rows.length >= 2, 'Should have imported sectors with default universe_id=1');
    for (const row of sectorRes.rows) {
      assert.equal(row.universe_id, 1, 'Sector should have universe_id = 1 by default');
    }
  });
});

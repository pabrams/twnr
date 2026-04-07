import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { ensureServer, createPool as _gsCreatePool } from './global-setup.mjs';

const { Pool } = pg;
const SERVER_DIR = process.cwd();
const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
const BASE = 'http://localhost:3000';

// ─── Helpers ────────────────────────────────────────────────────────────────

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

before(async () => {
  await ensureServer();
  pool = _gsCreatePool();
});

after(async () => {
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
      'SELECT id, universe_id, sector_number FROM sectors WHERE universe_id = $1 ORDER BY sector_number',
      [uid],
    );
    assert.ok(sectorRes.rows.length >= 2, `Should have imported at least 2 sectors for universe ${uid}`);
    for (const row of sectorRes.rows) {
      assert.equal(row.universe_id, uid, `Sector should have universe_id = ${uid}`);
    }

    // Verify warps were imported (joined through sectors)
    const warpRes = await pool.query(
      'SELECT w.from_sector_id, w.to_sector_id FROM warps w JOIN sectors s ON w.from_sector_id = s.id WHERE s.universe_id = $1',
      [uid],
    );
    assert.ok(warpRes.rows.length >= 2, 'Should have imported warps');

    // Verify ports were imported (joined through sectors)
    const portRes = await pool.query(
      'SELECT p.sector_id FROM ports p JOIN sectors s ON p.sector_id = s.id WHERE s.universe_id = $1',
      [uid],
    );
    assert.ok(portRes.rows.length >= 1, 'Should have imported ports');
  });

  it('defaults to universe_id=1 when --universe-id is not provided', async () => {
    // Verify the script source defaults to universe_id=1
    const { readFileSync } = await import('node:fs');
    const scriptSrc = readFileSync(join(SERVER_DIR, 'scripts', 'importUniverse.js'), 'utf8');
    assert.ok(
      /let\s+universeId\s*=\s*1/.test(scriptSrc),
      'importUniverse.js should default universeId to 1',
    );
  });
});

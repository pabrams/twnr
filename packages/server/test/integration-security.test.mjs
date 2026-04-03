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
  connectWS,
  closeWS,
  httpPost,
  testEnv,
} from './helpers.mjs';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = join(dirname(__filename), '..');
const UNIVERSE_ID = 1;

let pool;
let serverProc;

function ws(opts = {}) {
  return connectWS({ pool, universeId: UNIVERSE_ID, ...opts });
}

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

describe('Security', () => {
  it('rejects unsigned JWTs on protected REST endpoints', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ userId: 1, role: 'player' })).toString('base64url');
    const forgedToken = `${header}.${payload}.`;

    const res = await fetch('http://localhost:3000/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${forgedToken}` },
    });
    const body = await res.json();

    assert.equal(res.status, 403);
    assert.equal(body.error, 'Invalid token');
  });

  it('allows WebSocket connections from configured origins', async () => {
    const { ws: wsConn, welcome } = await ws({ origin: 'http://localhost:3000' });

    assert.equal(welcome.type, 'welcome');
    await closeWS(wsConn);
  });

  it('rejects WebSocket connections from unapproved origins', async () => {
    const { default: WebSocket } = await import('ws');

    await new Promise((resolve, reject) => {
      const wsConn = new WebSocket('ws://localhost:3000', { origin: 'https://evil.example' });
      const timer = setTimeout(() => {
        wsConn.terminate();
        reject(new Error('WS connect timeout'));
      }, 5000);

      wsConn.on('open', () => {
        clearTimeout(timer);
        wsConn.close();
        reject(new Error('Unexpectedly connected'));
      });
      wsConn.on('error', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  });


  it('stores new passwords with scrypt and ignores role from request body', async () => {
    const email = `pilot_${Date.now()}@example.com`;
    const password = 'correct horse battery staple';

    const registerRes = await httpPost('/api/auth/register', {
      name: 'Pilot',
      email,
      password,
      role: 'admin',
    });
    assert.equal(registerRes.status, 201);
    assert.equal(registerRes.body.role, 'player');

    const registered = await pool.query('SELECT password_hash, role FROM users WHERE email = $1', [email]);
    assert.equal(registered.rows[0].role, 'player');
    assert.ok(registered.rows[0].password_hash.startsWith('scrypt$'));
  });

  it('rejects login for accounts with legacy MD5 password hashes', async () => {
    const legacyEmail = `legacy_${Date.now()}@example.com`;
    const legacyHash = '5f4dcc3b5aa765d61d8327deb882cf99'; // md5('password')
    await pool.query(
      'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)',
      [legacyEmail, legacyHash, 'player'],
    );

    const loginRes = await httpPost('/api/auth/login', { email: legacyEmail, password: 'password' });
    assert.equal(loginRes.status, 401);
  });

});

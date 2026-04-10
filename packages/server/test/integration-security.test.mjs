import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { connectWS, closeWS, httpPost } from './helpers.mjs';
import { ensureServer, createPool, BASE, WS_BASE } from './global-setup.mjs';
import { ServerMsgType } from '@twnr/shared';
const UNIVERSE_ID = 1;

let pool;

function ws(opts = {}) {
  return connectWS({ pool, universeId: UNIVERSE_ID, ...opts });
}

before(async () => {
  await ensureServer();
  pool = createPool();
});

after(async () => {
  if (pool) await pool.end();
});

describe('Security', () => {
  it('rejects unsigned JWTs on protected REST endpoints', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ userId: 1, role: 'player' })).toString('base64url');
    const forgedToken = `${header}.${payload}.`;

    const res = await fetch(`${BASE}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${forgedToken}` },
    });
    const body = await res.json();

    assert.equal(res.status, 403);
    assert.equal(body.error, 'Invalid token');
  });

  it('allows WebSocket connections from configured origins', async () => {
    const { ws: wsConn, welcome } = await ws({ origin: BASE });

    assert.equal(welcome.type, ServerMsgType.Welcome);
    await closeWS(wsConn);
  });

  it('rejects WebSocket connections from unapproved origins', async () => {
    const { default: WebSocket } = await import('ws');

    await new Promise((resolve, reject) => {
      const wsConn = new WebSocket(`${WS_BASE}`, { origin: 'https://evil.example' });
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

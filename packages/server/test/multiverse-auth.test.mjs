import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ensureServer, createPool as _gsCreatePool, createTestUserWithToken, BASE } from './global-setup.mjs';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function createTestUser(name, email, password) {
  const { userId, token } = await createTestUserWithToken(pool, { name, email, password });
  return { status: 201, body: { userId }, token };
}

async function registerUser(name, email, password) {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  });
  const body = await res.json();
  let token = null;
  const cookies = res.headers.getSetCookie?.() || [];
  for (const c of cookies) {
    const match = c.match(/twnr_auth=([^;]+)/);
    if (match) token = match[1];
  }
  return { status: res.status, body, token };
}

async function loginUser(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  let token = null;
  const cookies = res.headers.getSetCookie?.() || [];
  for (const c of cookies) {
    const match = c.match(/twnr_auth=([^;]+)/);
    if (match) token = match[1];
  }
  return { status: res.status, body, token };
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

// ─── 5. Registration and Login ──────────────────────────────────────────────

describe('Registration', () => {
  it('POST /api/auth/register creates a user (not a player) and returns userId', async () => {
    const ts = Date.now();
    const { status, body } = await registerUser(`reg_${ts}`, `reg_${ts}@test.com`, 'pass123');
    assert.equal(status, 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
    assert.ok(body.userId !== undefined, 'Response should contain userId');

    // Verify user exists in users table
    const userRes = await pool.query('SELECT id, email FROM users WHERE id = $1', [body.userId]);
    assert.equal(userRes.rows.length, 1, 'User should exist in users table');

    // Verify NO player row was created
    const playerRes = await pool.query('SELECT id FROM players WHERE user_id = $1', [body.userId]);
    assert.equal(playerRes.rows.length, 0, 'No player should be created on registration');
  });

  it('POST /api/auth/register returns 409 for duplicate email', async () => {
    const ts = Date.now();
    const email = `dup_${ts}@test.com`;
    await registerUser(`dup1_${ts}`, email, 'pass123');
    const { status } = await registerUser(`dup2_${ts}`, email, 'pass456');
    assert.equal(status, 409, 'Should return 409 for duplicate email');
  });
});

describe('Login', () => {
  it('POST /api/auth/login authenticates against users table and returns userId', async () => {
    const ts = Date.now();
    const email = `login_${ts}@test.com`;
    await createTestUser(`login_${ts}`, email, 'pass123');

    const { status, body } = await loginUser(email, 'pass123');
    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert.ok(body.userId !== undefined, 'Response should contain userId');
  });

  it('login JWT payload contains userId, role, and tokenVersion', async () => {
    const ts = Date.now();
    const email = `jwtlogin_${ts}@test.com`;
    await createTestUser(`jwtlogin_${ts}`, email, 'pass123');

    const login = await loginUser(email, 'pass123');
    assert.ok(login.token, 'Should receive a JWT token on login');

    const decoded = jwt.verify(login.token, JWT_SECRET);
    assert.ok(decoded.userId !== undefined, 'Login JWT should contain userId');
    assert.ok(decoded.role !== undefined, 'Login JWT should contain role');
    assert.ok(decoded.tokenVersion !== undefined, 'Login JWT should contain tokenVersion');
  });

  it('POST /api/auth/login returns 401 for wrong password', async () => {
    const ts = Date.now();
    const email = `wrongpw_${ts}@test.com`;
    await createTestUser(`wrongpw_${ts}`, email, 'correctpass');

    const { status } = await loginUser(email, 'wrongpass');
    assert.equal(status, 401, 'Should return 401 for wrong password');
  });

  it('JWT payload contains userId instead of playerId', async () => {
    const ts = Date.now();
    const email = `jwt_${ts}@test.com`;
    const reg = await registerUser(`jwt_${ts}`, email, 'pass123');
    const token = reg.token;
    assert.ok(token, 'Should receive a JWT token');

    const decoded = jwt.verify(token, JWT_SECRET);
    assert.ok(decoded.userId !== undefined, 'JWT should contain userId');
    assert.equal(decoded.userId, reg.body.userId, 'JWT userId should match response userId');
  });
});

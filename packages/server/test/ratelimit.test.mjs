import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestUser, createTestPlayer } from './helpers.mjs';
import { ensureServer, createPool } from './global-setup.mjs';
import { ClientMsgType, ServerMsgType } from '@twnr/shared';

const UNIVERSE_ID = 1;

let pool;
let testPlayerToken;

async function post(path, body) {
  const res = await fetch(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.status;
}

before(async () => {
  await ensureServer();
  pool = createPool();
  const { userId, token } = await createTestUser(pool);
  await createTestPlayer(pool, userId, UNIVERSE_ID, `RateLimitTest_${Date.now()}`);
  testPlayerToken = token;
});

after(async () => {
  if (pool) await pool.end();
});

describe('Rate Limiting', () => {
  describe('Login endpoint', () => {
    it('allows 10 attempts then returns 429', async () => {
      const statuses = [];
      for (let i = 0; i < 11; i++) {
        statuses.push(await post('/api/auth/login', { email: 'nobody@example.com', password: 'wrong' }));
      }
      // First 10 should be 401 (bad credentials, not rate limited)
      for (let i = 0; i < 10; i++) {
        assert.equal(statuses[i], 401, `Request ${i + 1} should be 401, got ${statuses[i]}`);
      }
      // 11th should be rate limited
      assert.equal(statuses[10], 429, `Request 11 should be 429, got ${statuses[10]}`);
    });
  });

  describe('Register endpoint', () => {
    it('allows 5 attempts then returns 429', async () => {
      const statuses = [];
      for (let i = 0; i < 6; i++) {
        statuses.push(await post('/api/auth/register', {
          name: `Reg User ${i}`,
          email: `ratelimit_${i}@example.com`,
          password: 'testpassword123',
        }));
      }
      // First 5 should go through (201 created)
      for (let i = 0; i < 5; i++) {
        assert.equal(statuses[i], 201, `Request ${i + 1} should be 201, got ${statuses[i]}`);
      }
      // 6th should be rate limited
      assert.equal(statuses[5], 429, `Request 6 should be 429, got ${statuses[5]}`);
    });
  });

  describe('WebSocket token bucket', () => {
    it('rate limits after exhausting burst capacity of 50 messages', async () => {
      const { default: WebSocket } = await import('ws');

      // Connect with JWT cookie — universe param required
      const ws = await new Promise((resolve, reject) => {
        const conn = new WebSocket(`ws://localhost:3000/ws?universe=${UNIVERSE_ID}`, {
          headers: { Cookie: `twnr_auth=${testPlayerToken}` },
        });
        const timer = setTimeout(() => { conn.terminate(); reject(new Error('WS connect timeout')); }, 2000);
        conn.on('message', (data) => {
          const raw = JSON.parse(data.toString());
          const msg = raw.payload ?? raw;
          if (msg.type === ServerMsgType.Welcome) { clearTimeout(timer); resolve(conn); }
        });
        conn.on('error', (err) => { clearTimeout(timer); reject(err); });
      });

      const responses = [];
      ws.on('message', (data) => { const raw = JSON.parse(data.toString()); responses.push(raw.payload ?? raw); });

      // Send 55 display messages rapidly — burst cap is 50, so last 5 should be rate limited
      for (let i = 0; i < 55; i++) {
        ws.send(JSON.stringify({ type: ClientMsgType.SectorDisplay }));
      }

      // Wait for responses to settle
      await new Promise((resolve) => setTimeout(resolve, 500));
      ws.close();

      const rateLimited = responses.some((r) => r.type === ServerMsgType.RateLimited);
      assert.ok(rateLimited, `Expected a rateLimited message after 55 rapid messages, got: ${JSON.stringify(responses.map(r => r.type))}`);
    });
  });
});

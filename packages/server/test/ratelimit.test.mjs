import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestUser, createTestPlayer } from './helpers.mjs';
import { ensureServer, createPool, BASE, WS_BASE } from './global-setup.mjs';
import { ClientMsgType, ServerMsgType } from '@twnr/shared';

const UNIVERSE_ID = 1;

let pool;
let testPlayerToken;

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
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
        const conn = new WebSocket(`${WS_BASE}/ws?universe=${UNIVERSE_ID}`, {
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

  describe('WebSocket recovery after rate limit', () => {
    it('connection remains usable after receiving rateLimited messages', async () => {
      const { default: WebSocket } = await import('ws');

      const ws = await new Promise((resolve, reject) => {
        const conn = new WebSocket(`${WS_BASE}/ws?universe=${UNIVERSE_ID}`, {
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

      // Exhaust the burst capacity
      for (let i = 0; i < 55; i++) {
        ws.send(JSON.stringify({ type: ClientMsgType.SectorDisplay }));
      }

      // Wait for token bucket to refill (refills 20/sec)
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Now send one more request — should get a real response, not rateLimited
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('No response after rate limit recovery')), 2000);
        function handler(data) {
          const raw = JSON.parse(data.toString());
          const msg = raw.payload ?? raw;
          if (msg.type === ServerMsgType.SectorDisplayResult || msg.type === ServerMsgType.RateLimited) {
            clearTimeout(timer);
            ws.removeListener('message', handler);
            resolve(msg);
          }
        }
        ws.on('message', handler);
        ws.send(JSON.stringify({ type: ClientMsgType.SectorDisplay }));
      });

      ws.close();
      assert.equal(result.type, ServerMsgType.SectorDisplayResult,
        `Expected sectorDisplayResult after recovery, got ${result.type}`);
    });

    it('rapid Move commands during autopilot-like burst do not freeze the connection', async () => {
      const { default: WebSocket } = await import('ws');

      // Create a fresh player so we have a clean connection and known sector
      const freshPool = createPool();
      const { userId, token } = await createTestUser(freshPool);
      await createTestPlayer(freshPool, userId, UNIVERSE_ID, `AutopilotBurst_${Date.now()}`);
      await freshPool.end();

      const ws = await new Promise((resolve, reject) => {
        const conn = new WebSocket(`${WS_BASE}/ws?universe=${UNIVERSE_ID}`, {
          headers: { Cookie: `twnr_auth=${token}` },
        });
        const timer = setTimeout(() => { conn.terminate(); reject(new Error('WS connect timeout')); }, 2000);
        conn.on('message', (data) => {
          const raw = JSON.parse(data.toString());
          const msg = raw.payload ?? raw;
          if (msg.type === ServerMsgType.Welcome) { clearTimeout(timer); resolve(conn); }
        });
        conn.on('error', (err) => { clearTimeout(timer); reject(err); });
      });

      // Get current sector and find an adjacent sector to ping-pong between
      const sectorResult = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout')), 2000);
        function handler(data) {
          const raw = JSON.parse(data.toString());
          const msg = raw.payload ?? raw;
          if (msg.type === ServerMsgType.SectorDisplayResult) {
            clearTimeout(timer);
            ws.removeListener('message', handler);
            resolve(msg);
          }
        }
        ws.on('message', handler);
        ws.send(JSON.stringify({ type: ClientMsgType.SectorDisplay }));
      });

      const startSector = sectorResult.sector;
      const adjSector = sectorResult.warps[0]?.sector;
      assert.ok(adjSector, 'Need at least one adjacent sector');

      // Collect all responses
      const allResponses = [];
      ws.on('message', (data) => {
        const raw = JSON.parse(data.toString());
        allResponses.push(raw.payload ?? raw);
      });

      // Send 55 rapid Move commands (ping-pong) — this will trigger rate limiting
      for (let i = 0; i < 55; i++) {
        const target = i % 2 === 0 ? adjSector : startSector;
        ws.send(JSON.stringify({ type: ClientMsgType.Move, sector: target }));
      }

      // Wait for rate limit tokens to refill
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Verify we got at least one rateLimited response
      const gotRateLimited = allResponses.some((r) => r.type === ServerMsgType.RateLimited);
      assert.ok(gotRateLimited, 'Should have hit rate limit during burst');

      // Now verify the connection is still usable — send a SectorDisplay and expect a real response
      const recovery = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(
          'Connection frozen after rate-limited Move burst — rateLimited messages must be handled'
        )), 2000);
        function handler(data) {
          const raw = JSON.parse(data.toString());
          const msg = raw.payload ?? raw;
          if (msg.type === ServerMsgType.SectorDisplayResult) {
            clearTimeout(timer);
            ws.removeListener('message', handler);
            resolve(msg);
          }
        }
        ws.on('message', handler);
        ws.send(JSON.stringify({ type: ClientMsgType.SectorDisplay }));
      });

      ws.close();
      assert.equal(recovery.type, ServerMsgType.SectorDisplayResult,
        'Connection should be responsive after rate-limited burst');
    });
  });
});

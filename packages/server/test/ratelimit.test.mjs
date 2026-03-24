import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import { createPool, startServer } from './helpers.mjs';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = join(dirname(__filename), '..');
const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

let pool;
let serverProc;
let testPlayerToken;

function makeToken(playerId) {
  return jwt.sign({ playerId, name: 'Rate Test Player', role: 'player' }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
}

async function post(path, body) {
  const res = await fetch(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.status;
}

before(async () => {
  const universeDir = mkdtempSync(join(tmpdir(), 'twnr_ratelimit_'));
  try {
    rmSync(universeDir, { recursive: true, force: true });
    const gen = spawnSync(process.execPath, [
      join(PROJECT_ROOT, 'scripts', 'twnr-bigbang.js'),
      universeDir, '--sectors', '100', '--seed', '99',
    ], { encoding: 'utf8', cwd: PROJECT_ROOT });
    if (gen.status !== 0) throw new Error(`bigbang failed: ${gen.stderr}`);

    pool = createPool();
    await pool.query('DROP TABLE IF EXISTS ship_cargo, player_ships, ports, warps, players, sectors CASCADE');
    await pool.end();

    const imp = spawnSync(process.execPath, [
      join(PROJECT_ROOT, 'scripts', 'importUniverse.js'),
      universeDir, '--force',
    ], { encoding: 'utf8', cwd: PROJECT_ROOT, env: process.env });
    if (imp.status !== 0) throw new Error(`importUniverse failed: ${imp.stderr}`);

    serverProc = await startServer();
  } finally {
    rmSync(universeDir, { recursive: true, force: true });
  }

  pool = createPool();

  // Insert a player directly to avoid consuming register quota
  const res = await pool.query(
    `INSERT INTO players (name, email, password_hash, role, current_sector)
     VALUES ('Rate Test Player', 'ratetest@example.com', 'dummy', 'player', 1)
     RETURNING id`,
  );
  const playerId = res.rows[0].id;
  await pool.query(
    `INSERT INTO ship_cargo (player_id, fuel, organics, equipment, credits) VALUES ($1, 0, 0, 0, 10000)`,
    [playerId],
  );
  testPlayerToken = makeToken(playerId);
});

after(async () => {
  if (serverProc) serverProc.kill();
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

      // Connect with JWT cookie
      const ws = await new Promise((resolve, reject) => {
        const conn = new WebSocket('ws://localhost:3000/ws', {
          headers: { Cookie: `twnr_auth=${testPlayerToken}` },
        });
        const timer = setTimeout(() => { conn.terminate(); reject(new Error('WS connect timeout')); }, 5000);
        // Wait for welcome before resolving
        conn.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'welcome') { clearTimeout(timer); resolve(conn); }
        });
        conn.on('error', (err) => { clearTimeout(timer); reject(err); });
      });

      const responses = [];
      ws.on('message', (data) => responses.push(JSON.parse(data.toString())));

      // Send 55 display messages rapidly — burst cap is 50, so last 5 should be rate limited
      for (let i = 0; i < 55; i++) {
        ws.send(JSON.stringify({ type: 'display' }));
      }

      // Wait for responses to settle
      await new Promise((resolve) => setTimeout(resolve, 1500));
      ws.close();

      const rateLimited = responses.some((r) => r.type === 'rateLimited');
      assert.ok(rateLimited, `Expected a rateLimited message after 55 rapid messages, got: ${JSON.stringify(responses.map(r => r.type))}`);
    });
  });
});

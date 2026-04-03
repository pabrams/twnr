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
  createTestUser,
  createTestPlayer,
  connectWS,
  closeWS,
  wsRequest,
  testEnv,
} from './helpers.mjs';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = join(dirname(__filename), '..');
const UNIVERSE_ID = 1;

let pool;
let serverProc;

async function createPlayer(name, sector = 1, fighters = 0, shields = 0) {
  const { userId, token } = await createTestUser(pool);
  const playerId = await createTestPlayer(pool, userId, UNIVERSE_ID, name, sector, fighters, shields);
  return { id: playerId, token };
}

async function connectPlayer(token) {
  return connectWS({ token, universeId: UNIVERSE_ID });
}

before(async () => {
  const universeDir = mkdtempSync(join(tmpdir(), 'twnr_attack_test_'));
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

// ─── Shared types ───────────────────────────────────────────────────────────

describe('Shared types', () => {
  it('ClientMsgType should include Attack', async () => {
    const shared = await import('@twnr/shared');
    assert.ok(shared.ClientMsgType.Attack, 'ClientMsgType.Attack should be defined');
    assert.equal(typeof shared.ClientMsgType.Attack, 'string');
  });

  it('ServerMsgType should include AttackResult', async () => {
    const shared = await import('@twnr/shared');
    assert.ok(shared.ServerMsgType.AttackResult, 'ServerMsgType.AttackResult should be defined');
    assert.equal(typeof shared.ServerMsgType.AttackResult, 'string');
  });
});

// ─── Schema ─────────────────────────────────────────────────────────────────

describe('Schema', () => {
  it('players table should have ship_destroyed_date column', async () => {
    const res = await pool.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = 'players' AND column_name = 'ship_destroyed_date'`,
    );
    assert.equal(res.rows.length, 1, 'ship_destroyed_date column should exist');
    assert.ok(
      res.rows[0].data_type.includes('timestamp'),
      `Expected timestamp type, got ${res.rows[0].data_type}`,
    );
  });
});

// ─── Attack validation ──────────────────────────────────────────────────────

describe('Attack validation', () => {
  it('should reject attack on self', async () => {
    const p = await createPlayer('self_atk', 1, 5, 0);
    const { ws } = await connectPlayer(p.token);
    try {
      const res = await wsRequest(ws, { type: 'attack', targetPlayerId: p.id, fighters: 1 }, 'attackResult');
      assert.equal(res.type, 'error', 'Should return error for self-attack');
    } finally {
      await closeWS(ws);
    }
  });

  it('should reject attack with 0 fighters', async () => {
    const atk = await createPlayer('atk_zero', 1, 5, 0);
    const def = await createPlayer('def_zero', 1, 5, 0);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    try {
      const res = await wsRequest(ws1, { type: 'attack', targetPlayerId: def.id, fighters: 0 }, 'attackResult');
      assert.equal(res.type, 'error');
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
    }
  });

  it('should reject attack with negative fighters', async () => {
    const atk = await createPlayer('atk_neg', 1, 5, 0);
    const def = await createPlayer('def_neg', 1, 5, 0);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    try {
      const res = await wsRequest(ws1, { type: 'attack', targetPlayerId: def.id, fighters: -1 }, 'attackResult');
      assert.equal(res.type, 'error');
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
    }
  });

  it('should reject attack when attacker lacks enough fighters', async () => {
    const atk = await createPlayer('atk_few', 1, 3, 0);
    const def = await createPlayer('def_few', 1, 5, 0);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    try {
      const res = await wsRequest(ws1, { type: 'attack', targetPlayerId: def.id, fighters: 5 }, 'attackResult');
      assert.equal(res.type, 'error');
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
    }
  });

  it('should reject attack when players are in different sectors', async () => {
    const atk = await createPlayer('atk_diff', 1, 5, 0);
    const def = await createPlayer('def_diff', 2, 5, 0);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    try {
      const res = await wsRequest(ws1, { type: 'attack', targetPlayerId: def.id, fighters: 1 }, 'attackResult');
      assert.equal(res.type, 'error');
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
    }
  });
});

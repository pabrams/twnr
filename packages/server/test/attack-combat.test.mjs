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

// ─── Combat resolution ──────────────────────────────────────────────────────

describe('Combat resolution', () => {
  it('shields absorb first at 1:1 (attacker fighters consumed by shields)', async () => {
    const atk = await createPlayer('atk_sh1', 1, 10, 0);
    const def = await createPlayer('def_sh1', 1, 0, 5);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    try {
      const res = await wsRequest(ws1, { type: 'attack', targetPlayerId: def.id, fighters: 3 }, 'attackResult');
      assert.equal(res.type, 'attackResult');

      const atkShip = await pool.query('SELECT fighters FROM player_ships WHERE player_id = $1', [atk.id]);
      assert.equal(atkShip.rows[0].fighters, 7, 'Attacker should have 7 fighters remaining');
      const defShip = await pool.query('SELECT shields, fighters FROM player_ships WHERE player_id = $1', [def.id]);
      assert.equal(defShip.rows[0].shields, 2, 'Defender should have 2 shields remaining');
      assert.equal(defShip.rows[0].fighters, 0, 'Defender fighters should be unchanged at 0');
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
    }
  });

  it('fighters engage after shields at 1:1 (mutual destruction)', async () => {
    const atk = await createPlayer('atk_mix', 1, 10, 0);
    const def = await createPlayer('def_mix', 1, 3, 2);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    try {
      const res = await wsRequest(ws1, { type: 'attack', targetPlayerId: def.id, fighters: 4 }, 'attackResult');
      assert.equal(res.type, 'attackResult');

      const atkShip = await pool.query('SELECT fighters FROM player_ships WHERE player_id = $1', [atk.id]);
      assert.equal(atkShip.rows[0].fighters, 6, 'Attacker should have 6 fighters remaining');
      const defShip = await pool.query('SELECT fighters, shields FROM player_ships WHERE player_id = $1', [def.id]);
      assert.equal(defShip.rows[0].fighters, 1, 'Defender should have 1 fighter remaining');
      assert.equal(defShip.rows[0].shields, 0, 'Defender should have 0 shields remaining');
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
    }
  });

  it('exact tie: attacker runs out at same time as defender defenses', async () => {
    const atk = await createPlayer('atk_tie', 1, 10, 0);
    const def = await createPlayer('def_tie', 1, 2, 3);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    try {
      const res = await wsRequest(ws1, { type: 'attack', targetPlayerId: def.id, fighters: 5 }, 'attackResult');
      assert.equal(res.type, 'attackResult');

      const atkShip = await pool.query('SELECT fighters FROM player_ships WHERE player_id = $1', [atk.id]);
      assert.equal(atkShip.rows[0].fighters, 5, 'Attacker should have 5 fighters remaining');
      const defShip = await pool.query('SELECT fighters, shields FROM player_ships WHERE player_id = $1', [def.id]);
      assert.equal(defShip.rows.length, 1, 'Defender ship should still exist (exact tie, no remaining attackers)');
      assert.equal(defShip.rows[0].fighters, 0, 'Defender should have 0 fighters');
      assert.equal(defShip.rows[0].shields, 0, 'Defender should have 0 shields');
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
    }
  });
});

// ─── Ship destruction ───────────────────────────────────────────────────────

describe('Ship destruction', () => {
  it('destroys ship when attacker overwhelms all defenses', async () => {
    const atk = await createPlayer('atk_dest', 1, 10, 0);
    const def = await createPlayer('def_dest', 1, 1, 1);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    try {
      const res = await wsRequest(ws1, { type: 'attack', targetPlayerId: def.id, fighters: 5 }, 'attackResult');
      assert.equal(res.type, 'attackResult');

      const atkShip = await pool.query('SELECT fighters FROM player_ships WHERE player_id = $1', [atk.id]);
      assert.equal(atkShip.rows[0].fighters, 8, 'Attacker should have 8 fighters remaining');

      const defShip = await pool.query('SELECT * FROM player_ships WHERE player_id = $1', [def.id]);
      assert.equal(defShip.rows.length, 0, 'Defender ship should be deleted');
      const defCargo = await pool.query('SELECT * FROM ship_cargo WHERE player_id = $1', [def.id]);
      assert.equal(defCargo.rows.length, 0, 'Defender cargo should be deleted');

      const defPlayer = await pool.query('SELECT ship_destroyed_date FROM players WHERE id = $1', [def.id]);
      assert.ok(defPlayer.rows[0].ship_destroyed_date, 'ship_destroyed_date should be set');
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
    }
  });

  it('destroys ship when defender has 0 shields and 0 fighters', async () => {
    const atk = await createPlayer('atk_bare', 1, 5, 0);
    const def = await createPlayer('def_bare', 1, 0, 0);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    try {
      const res = await wsRequest(ws1, { type: 'attack', targetPlayerId: def.id, fighters: 1 }, 'attackResult');
      assert.equal(res.type, 'attackResult');

      const atkShip = await pool.query('SELECT fighters FROM player_ships WHERE player_id = $1', [atk.id]);
      assert.equal(atkShip.rows[0].fighters, 5, 'Attacker should still have 5 fighters');

      const defShip = await pool.query('SELECT * FROM player_ships WHERE player_id = $1', [def.id]);
      assert.equal(defShip.rows.length, 0, 'Defender ship should be deleted');

      const defPlayer = await pool.query('SELECT ship_destroyed_date FROM players WHERE id = $1', [def.id]);
      assert.ok(defPlayer.rows[0].ship_destroyed_date, 'ship_destroyed_date should be set');
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
    }
  });
});

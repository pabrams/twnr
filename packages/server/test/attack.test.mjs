import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import {
  createPool,
  startServer,
  connectWS,
  closeWS,
  wsRequest,
} from './helpers.mjs';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = join(dirname(__filename), '..');

let pool;
let serverProc;

async function createPlayer(name, sector = 1, fighters = 0, shields = 0) {
  const ts = Date.now() + Math.random();
  const res = await pool.query(
    `INSERT INTO players (name, email, password_hash, role, current_sector)
     VALUES ($1, $2, 'scrypt$dGVzdHNhbHQ$dGVzdGtleQ', 'player', $3) RETURNING id, token_version`,
    [name, `${name}_${ts}@test.com`, sector],
  );
  const playerId = res.rows[0].id;
  const tokenVersion = res.rows[0].token_version;

  await pool.query(
    `INSERT INTO ship_cargo (player_id, fuel, organics, equipment, credits)
     VALUES ($1, 0, 0, 0, 10000)`,
    [playerId],
  );
  await pool.query(
    `INSERT INTO player_ships (player_id, ship_name, fighters, shields, cargo_limit)
     VALUES ($1, 'Merchant Freighter', $2, $3, 5)`,
    [playerId, fighters, shields],
  );

  const token = jwt.sign(
    { playerId, name, role: 'player', tokenVersion },
    process.env.JWT_SECRET || 'test-jwt-secret',
    { algorithm: 'HS256', expiresIn: '1h' },
  );

  return { id: playerId, token };
}

async function connectPlayer(token) {
  return connectWS({ token });
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

// ─── Combat resolution ──────────────────────────────────────────────────────

describe('Combat resolution', () => {
  it('shields absorb first at 1:1 (attacker fighters consumed by shields)', async () => {
    // Attacker: 10 fighters. Defender: 0 fighters, 5 shields. Attack with 3.
    // 3 attacking fighters hit 5 shields → 3 shields destroyed, 0 fighters destroyed.
    // Attacker loses 3 fighters (equal to shields+fighters destroyed = 3+0).
    const atk = await createPlayer('atk_sh1', 1, 10, 0);
    const def = await createPlayer('def_sh1', 1, 0, 5);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    try {
      const res = await wsRequest(ws1, { type: 'attack', targetPlayerId: def.id, fighters: 3 }, 'attackResult');
      assert.equal(res.type, 'attackResult');

      // Verify DB state: attacker should have 10-3=7 fighters
      const atkShip = await pool.query('SELECT fighters FROM player_ships WHERE player_id = $1', [atk.id]);
      assert.equal(atkShip.rows[0].fighters, 7, 'Attacker should have 7 fighters remaining');
      // Defender: shields 5-3=2, fighters still 0
      const defShip = await pool.query('SELECT shields, fighters FROM player_ships WHERE player_id = $1', [def.id]);
      assert.equal(defShip.rows[0].shields, 2, 'Defender should have 2 shields remaining');
      assert.equal(defShip.rows[0].fighters, 0, 'Defender fighters should be unchanged at 0');
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
    }
  });

  it('fighters engage after shields at 1:1 (mutual destruction)', async () => {
    // Attacker: 10 fighters. Defender: 3 fighters, 2 shields. Attack with 4.
    // 4 attacking → 2 shields destroyed (2 attackers used), then 2 remaining attackers → 2 defender fighters destroyed.
    // Attacker loses 2+2=4 fighters.
    const atk = await createPlayer('atk_mix', 1, 10, 0);
    const def = await createPlayer('def_mix', 1, 3, 2);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    try {
      const res = await wsRequest(ws1, { type: 'attack', targetPlayerId: def.id, fighters: 4 }, 'attackResult');
      assert.equal(res.type, 'attackResult');

      // Verify DB state: attacker 10-4=6 fighters
      const atkShip = await pool.query('SELECT fighters FROM player_ships WHERE player_id = $1', [atk.id]);
      assert.equal(atkShip.rows[0].fighters, 6, 'Attacker should have 6 fighters remaining');
      // Defender: shields 0, fighters 3-2=1
      const defShip = await pool.query('SELECT fighters, shields FROM player_ships WHERE player_id = $1', [def.id]);
      assert.equal(defShip.rows[0].fighters, 1, 'Defender should have 1 fighter remaining');
      assert.equal(defShip.rows[0].shields, 0, 'Defender should have 0 shields remaining');
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
    }
  });

  it('exact tie: attacker runs out at same time as defender defenses', async () => {
    // Attacker: 10 fighters. Defender: 2 fighters, 3 shields. Attack with 5.
    // 5 attacking → 3 shields destroyed (3 used), then 2 remaining → 2 defender fighters destroyed.
    // All defenses gone but 0 remaining attackers → ship NOT destroyed.
    const atk = await createPlayer('atk_tie', 1, 10, 0);
    const def = await createPlayer('def_tie', 1, 2, 3);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    try {
      const res = await wsRequest(ws1, { type: 'attack', targetPlayerId: def.id, fighters: 5 }, 'attackResult');
      assert.equal(res.type, 'attackResult');

      // Attacker should have 10-5=5 fighters
      const atkShip = await pool.query('SELECT fighters FROM player_ships WHERE player_id = $1', [atk.id]);
      assert.equal(atkShip.rows[0].fighters, 5, 'Attacker should have 5 fighters remaining');
      // Defender ship should still exist with 0/0
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
    // Attacker: 10 fighters. Defender: 1 fighter, 1 shield. Attack with 5.
    // 5 attacking → 1 shield destroyed (1 used), 1 fighter destroyed (1 used), 3 remaining → ship destroyed.
    // Attacker loses 1+1=2 fighters.
    const atk = await createPlayer('atk_dest', 1, 10, 0);
    const def = await createPlayer('def_dest', 1, 1, 1);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    try {
      const res = await wsRequest(ws1, { type: 'attack', targetPlayerId: def.id, fighters: 5 }, 'attackResult');
      assert.equal(res.type, 'attackResult');

      // Attacker should have 10-2=8 fighters
      const atkShip = await pool.query('SELECT fighters FROM player_ships WHERE player_id = $1', [atk.id]);
      assert.equal(atkShip.rows[0].fighters, 8, 'Attacker should have 8 fighters remaining');

      // Defender ship and cargo should be deleted
      const defShip = await pool.query('SELECT * FROM player_ships WHERE player_id = $1', [def.id]);
      assert.equal(defShip.rows.length, 0, 'Defender ship should be deleted');
      const defCargo = await pool.query('SELECT * FROM ship_cargo WHERE player_id = $1', [def.id]);
      assert.equal(defCargo.rows.length, 0, 'Defender cargo should be deleted');

      // ship_destroyed_date should be set on the player
      const defPlayer = await pool.query('SELECT ship_destroyed_date FROM players WHERE id = $1', [def.id]);
      assert.ok(defPlayer.rows[0].ship_destroyed_date, 'ship_destroyed_date should be set');
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
    }
  });

  it('destroys ship when defender has 0 shields and 0 fighters', async () => {
    // Defender has no defenses at all. Attacking with 1+ fighter should destroy.
    // Attacker loses 0 fighters (0 shields + 0 fighters destroyed).
    const atk = await createPlayer('atk_bare', 1, 5, 0);
    const def = await createPlayer('def_bare', 1, 0, 0);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    try {
      const res = await wsRequest(ws1, { type: 'attack', targetPlayerId: def.id, fighters: 1 }, 'attackResult');
      assert.equal(res.type, 'attackResult');

      // Attacker should still have all 5 fighters (lost 0)
      const atkShip = await pool.query('SELECT fighters FROM player_ships WHERE player_id = $1', [atk.id]);
      assert.equal(atkShip.rows[0].fighters, 5, 'Attacker should still have 5 fighters');

      // Defender ship should be deleted
      const defShip = await pool.query('SELECT * FROM player_ships WHERE player_id = $1', [def.id]);
      assert.equal(defShip.rows.length, 0, 'Defender ship should be deleted');

      // ship_destroyed_date should be set
      const defPlayer = await pool.query('SELECT ship_destroyed_date FROM players WHERE id = $1', [def.id]);
      assert.ok(defPlayer.rows[0].ship_destroyed_date, 'ship_destroyed_date should be set');
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
    }
  });
});

// ─── Login restriction for destroyed players ────────────────────────────────

describe('Login restriction after ship destruction', () => {
  it('allows login and gives new ship when delay has passed (default delay=0)', async () => {
    const ts = Date.now() + Math.random();
    const email = `destroyed_${ts}@test.com`;
    const password = 'testpass123';

    const regRes = await fetch('http://localhost:3000/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'DestroyedPlayer', email, password }),
    });
    assert.equal(regRes.status, 201);
    const playerId = (await regRes.json()).playerId;

    await pool.query('UPDATE players SET ship_destroyed_date = NOW() WHERE id = $1', [playerId]);

    const loginRes = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    assert.equal(loginRes.status, 200);

    const playerRes = await pool.query('SELECT ship_destroyed_date FROM players WHERE id = $1', [playerId]);
    assert.equal(playerRes.rows[0].ship_destroyed_date, null, 'ship_destroyed_date should be cleared');

    const shipRes = await pool.query('SELECT ship_name, fighters, shields, cargo_limit FROM player_ships WHERE player_id = $1', [playerId]);
    assert.equal(shipRes.rows.length, 1, 'Should have a new ship');
    assert.equal(shipRes.rows[0].ship_name, 'Merchant Freighter');
    assert.equal(shipRes.rows[0].fighters, 0);
    assert.equal(shipRes.rows[0].shields, 0);

    const cargoRes = await pool.query('SELECT credits FROM ship_cargo WHERE player_id = $1', [playerId]);
    assert.equal(cargoRes.rows.length, 1, 'Should have cargo');
    assert.equal(cargoRes.rows[0].credits, 10000);
  });

  it('refuses login with 403 when delay has not passed', async () => {
    const ts = Date.now() + Math.random();
    const email = `refused_${ts}@test.com`;
    const password = 'testpass456';

    const regRes = await fetch('http://localhost:3000/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'RefusedPlayer', email, password }),
    });
    assert.equal(regRes.status, 201);
    const playerId = (await regRes.json()).playerId;

    // Set destroyed date 1 hour in the future → elapsed will be negative → always less than delay
    await pool.query(
      `UPDATE players SET ship_destroyed_date = NOW() + INTERVAL '1 hour' WHERE id = $1`,
      [playerId],
    );

    const loginRes = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    assert.equal(loginRes.status, 403, 'Should refuse login with 403');
    const body = await loginRes.json();
    assert.ok(
      body.error && body.error.toLowerCase().includes('destroyed'),
      `Error message should mention "destroyed", got: ${body.error}`,
    );
  });

  it('gives new Merchant Freighter with correct stats on re-login after destruction', async () => {
    const ts = Date.now() + Math.random();
    const email = `newship_${ts}@test.com`;
    const password = 'testpass789';

    const regRes = await fetch('http://localhost:3000/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'NewShipPlayer', email, password }),
    });
    assert.equal(regRes.status, 201);
    const playerId = (await regRes.json()).playerId;

    await pool.query('DELETE FROM player_ships WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM ship_cargo WHERE player_id = $1', [playerId]);
    await pool.query(
      `UPDATE players SET ship_destroyed_date = NOW() - INTERVAL '1 hour' WHERE id = $1`,
      [playerId],
    );

    const loginRes = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(loginRes.status, 200);

    const ship = await pool.query(
      'SELECT ship_name, fighters, shields, cargo_limit FROM player_ships WHERE player_id = $1',
      [playerId],
    );
    assert.equal(ship.rows.length, 1);
    assert.equal(ship.rows[0].ship_name, 'Merchant Freighter');
    assert.equal(ship.rows[0].fighters, 0);
    assert.equal(ship.rows[0].shields, 0);

    const cargo = await pool.query('SELECT credits FROM ship_cargo WHERE player_id = $1', [playerId]);
    assert.equal(cargo.rows.length, 1);
    assert.equal(cargo.rows[0].credits, 10000);

    const player = await pool.query('SELECT ship_destroyed_date FROM players WHERE id = $1', [playerId]);
    assert.equal(player.rows[0].ship_destroyed_date, null);
  });
});

// ─── Attack result message ──────────────────────────────────────────────────

describe('Attack result message', () => {
  it('returns a non-error attackResult response on successful attack', async () => {
    const atk = await createPlayer('atk_fmt', 1, 5, 0);
    const def = await createPlayer('def_fmt', 1, 2, 3);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    try {
      const res = await wsRequest(ws1, { type: 'attack', targetPlayerId: def.id, fighters: 2 }, 'attackResult');
      assert.equal(res.type, 'attackResult', 'Should receive an attackResult message');
      assert.notEqual(res.type, 'error', 'Should not be an error');
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
    }
  });
});

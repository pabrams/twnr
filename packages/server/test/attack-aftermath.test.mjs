import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestUser, createTestPlayer, connectWS, closeWS, wsRequest } from './helpers.mjs';
import { ensureServer, createPool, BASE, WS_BASE } from './global-setup.mjs';
import { ClientTag, ServerTag } from '@twnr/shared';

async function wsConnectExpectClose(token, universeId, timeoutMs = 3000) {
  const { default: WebSocket } = await import('ws');
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}/ws?universe=${universeId}`, {
      headers: { Cookie: `twnr_auth=${token}` },
    });
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('ws close timeout'));
    }, timeoutMs);
    let settled = false;
    ws.on('close', (code, reasonBuf) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, reason: reasonBuf.toString() });
    });
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'welcome') {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ws.close();
        resolve({ welcomed: true });
      }
    });
    ws.on('error', () => { /* close fires after */ });
  });
}

const UNIVERSE_ID = 1;
let pool;

async function createPlayer(name, sector = 1, drones = 0, shields = 0) {
  const { userId, token } = await createTestUser(pool);
  const playerId = await createTestPlayer(pool, userId, UNIVERSE_ID, name, sector, drones, shields);
  return { id: playerId, token };
}

async function connectPlayer(token) {
  return connectWS({ token, universeId: UNIVERSE_ID });
}

before(async () => {
  await ensureServer();
  pool = createPool();
});

after(async () => {
  if (pool) await pool.end();
});

// ─── WS reconnect after ship destruction ────────────────────────────────────
//
// Site auth (HTTP /api/auth/login) is universe-agnostic: it always succeeds
// for valid credentials regardless of destroyed state. The destroyed-cooldown
// is enforced at WebSocket connect time for the specific universe, and the
// respawn (new ship + sector 1 + credits) happens inline as part of that
// connect when the cooldown has elapsed.

describe('WS reconnect after ship destruction', () => {
  async function setupDestroyedPlayer(emailPrefix) {
    const ts = Date.now() + Math.random();
    const email = `${emailPrefix}_${ts}@test.com`;
    const password = 'testpass123';
    const regRes = await fetch(`${BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `${emailPrefix}_${ts}`, email, password }),
    });
    assert.equal(regRes.status, 201);
    const regCookies = regRes.headers.getSetCookie?.() || [];
    let regToken = null;
    for (const c of regCookies) {
      const match = c.match(/twnr_auth=([^;]+)/);
      if (match) regToken = match[1];
    }
    const joinRes = await fetch(`${BASE}/api/universes/${UNIVERSE_ID}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `twnr_auth=${regToken}` },
      body: JSON.stringify({ name: `${emailPrefix}P_${ts}` }),
    });
    assert.equal(joinRes.status, 201);
    const { playerId } = await joinRes.json();
    return { token: regToken, playerId, email, password };
  }

  it('reconnect respawns and grants a fresh Vulpeculan Cruiser when cooldown has passed', async () => {
    const { token, playerId } = await setupDestroyedPlayer('destroyed');
    await pool.query('UPDATE players SET ship_id = NULL WHERE id = $1', [playerId]);
    await pool.query('DELETE FROM ships WHERE owner_id = $1', [playerId]);
    await pool.query(
      "UPDATE players SET ship_destroyed_date = NOW() - INTERVAL '30 days' WHERE id = $1",
      [playerId],
    );

    const result = await wsConnectExpectClose(token, UNIVERSE_ID);
    assert.equal(result.welcomed, true, 'WS connect should succeed after respawn');

    const playerRow = await pool.query('SELECT ship_destroyed_date FROM players WHERE id = $1', [playerId]);
    assert.equal(playerRow.rows[0].ship_destroyed_date, null, 'ship_destroyed_date should be cleared');

    const ship = await pool.query(
      'SELECT s.drones, s.shields, s.holds, st.name as ship_name FROM ships s JOIN ship_types st ON s.ship_type_id = st.id WHERE s.id = (SELECT ship_id FROM players WHERE id = $1)',
      [playerId],
    );
    assert.equal(ship.rows.length, 1, 'Should have a new ship');
    assert.equal(ship.rows[0].ship_name, 'Vulpeculan Cruiser');
    assert.equal(ship.rows[0].drones, 100);
    assert.equal(ship.rows[0].shields, 0);

    const credits = await pool.query('SELECT credits FROM players WHERE id = $1', [playerId]);
    assert.equal(credits.rows[0].credits, 10000);
  });

  it('rejects WS connect with 1008 + reason when cooldown has not passed', async () => {
    const { token, playerId } = await setupDestroyedPlayer('refused');
    await pool.query(
      `UPDATE players SET ship_destroyed_date = NOW() + INTERVAL '1 hour' WHERE id = $1`,
      [playerId],
    );

    const result = await wsConnectExpectClose(token, UNIVERSE_ID);
    assert.equal(result.code, 1008);
    assert.match(result.reason, /destroyed/i);
  });

  it('site login still succeeds while a player is in destroyed-cooldown', async () => {
    const { email, password, playerId } = await setupDestroyedPlayer('siteok');
    await pool.query(
      `UPDATE players SET ship_destroyed_date = NOW() + INTERVAL '1 hour' WHERE id = $1`,
      [playerId],
    );

    const loginRes = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(loginRes.status, 200, 'site login is independent of per-universe state');
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
      const res = await wsRequest(ws1, { type: ClientTag.AttackShip, targetPlayerId: def.id, drones: 2 }, ServerTag.AttackShipResult);
      assert.equal(res.type, ServerTag.AttackShipResult, 'Should receive an attackResult message');
      assert.notEqual(res.type, ServerTag.Error, 'Should not be an error');
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
    }
  });
});

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ensureServer, createPool as _gsCreatePool, createTestUserWithToken, BASE, WS_BASE } from './global-setup.mjs';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function createTestUser(name, email, password) {
  const { userId, token } = await createTestUserWithToken(pool, { name, email, password });
  return { status: 201, body: { userId }, token };
}

async function createUniverse(token, name) {
  const res = await fetch(`${BASE}/api/universes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `twnr_auth=${token}`,
    },
    body: JSON.stringify({ name }),
  });
  return { status: res.status, body: await res.json() };
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

async function joinUniverse(token, universeId, name = 'TestPlayer') {
  const res = await fetch(`${BASE}/api/universes/${universeId}/join`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `twnr_auth=${token}`,
    },
    body: JSON.stringify({ name }),
  });
  return { status: res.status, body: await res.json() };
}

/** Seed minimal sector/warp data for a universe directly in DB */
async function seedUniverseSectors(pool, universeId, numSectors = 5) {
  const sectorIds = {}; // sector_number -> DB id
  for (let i = 1; i <= numSectors; i++) {
    const res = await pool.query(
      'INSERT INTO sectors (universe_id, sector_number, name) VALUES ($1, $2, $3) RETURNING id',
      [universeId, i, i === 1 ? 'Federation Space' : null],
    );
    sectorIds[i] = res.rows[0].id;
  }
  for (let i = 1; i <= numSectors; i++) {
    const next = i < numSectors ? i + 1 : 1;
    await pool.query(
      'INSERT INTO warps (from_sector_id, to_sector_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [sectorIds[i], sectorIds[next]],
    );
    await pool.query(
      'INSERT INTO warps (from_sector_id, to_sector_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [sectorIds[next], sectorIds[i]],
    );
  }
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

// ─── Site login is independent of per-universe destruction state ────────────
//
// Site auth (HTTP /api/auth/login) does NOT consult ship_destroyed_date —
// the user can still log in and browse universes. The destroyed-cooldown
// is enforced at WebSocket connect time for the specific universe being
// entered (see src/services/respawn.ts).

function wsConnectExpectClose(token, universeId, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    import('ws').then(({ default: WebSocket }) => {
      const ws = new WebSocket(`${WS_BASE}/ws?universe=${universeId}`, {
        headers: { Cookie: `twnr_auth=${token}` },
      });
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error('ws close timeout'));
      }, timeoutMs);
      let closed = false;
      ws.on('close', (code, reasonBuf) => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        resolve({ code, reason: reasonBuf.toString() });
      });
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'welcome') {
          if (closed) return;
          closed = true;
          clearTimeout(timer);
          ws.close();
          resolve({ code: null, reason: null, welcomed: true });
        }
      });
      ws.on('error', () => { /* close fires after */ });
    }).catch(reject);
  });
}

describe('Site login is independent of destruction state', () => {
  it('allows site login even when a player is in destroyed-cooldown', async () => {
    const ts = Date.now();
    const email = `sitelogin_${ts}@test.com`;
    const reg = await createTestUser(`sitelogin_${ts}`, email, 'pass123');
    const univ = await createUniverse(reg.token, `SiteLogin ${ts}`);
    await seedUniverseSectors(pool, univ.body.universeId);
    const join = await joinUniverse(reg.token, univ.body.universeId, 'Site');

    await pool.query(
      `UPDATE players SET ship_destroyed_date = NOW() + INTERVAL '1 hour' WHERE id = $1`,
      [join.body.playerId],
    );

    const login = await loginUser(email, 'pass123');
    assert.equal(login.status, 200, 'site login should not be blocked by destroyed cooldown');
  });
});

describe('WebSocket connect enforces destruction cooldown', () => {
  it('respawns when ship_destroyed_date is set and delay has passed', async () => {
    const ts = Date.now();
    const email = `dest_${ts}@test.com`;
    const reg = await createTestUser(`dest_${ts}`, email, 'pass123');
    const univ = await createUniverse(reg.token, `DestTest ${ts}`);
    await seedUniverseSectors(pool, univ.body.universeId);
    const join = await joinUniverse(reg.token, univ.body.universeId, 'Destroyed');

    // Simulate destruction 30 days ago so any reasonable cooldown
    // (universeConfig.respawnDelaySeconds defaults to 24h) has passed.
    await pool.query(
      "UPDATE players SET ship_destroyed_date = NOW() - INTERVAL '30 days', ship_id = NULL WHERE id = $1",
      [join.body.playerId],
    );
    await pool.query('DELETE FROM ships WHERE owner_id = $1', [join.body.playerId]);

    const result = await wsConnectExpectClose(reg.token, univ.body.universeId);
    assert.equal(result.welcomed, true, 'WS should accept connection after respawn');

    const playerRes = await pool.query('SELECT ship_destroyed_date FROM players WHERE id = $1', [join.body.playerId]);
    assert.equal(playerRes.rows[0].ship_destroyed_date, null, 'ship_destroyed_date should be cleared');

    const shipRes = await pool.query('SELECT st.name as ship_name FROM ships s JOIN ship_types st ON s.ship_type_id = st.id WHERE s.id = (SELECT ship_id FROM players WHERE id = $1)', [join.body.playerId]);
    assert.equal(shipRes.rows.length, 1, 'New ship should be created');
    assert.equal(shipRes.rows[0].ship_name, 'Vulpeculan Cruiser');

    const creditsRes = await pool.query('SELECT credits FROM players WHERE id = $1', [join.body.playerId]);
    assert.equal(creditsRes.rows[0].credits, 10000);
  });

  it('rejects WS connect with 1008 + reason when delay has not passed', async () => {
    const ts = Date.now();
    const email = `nodelay_${ts}@test.com`;
    const reg = await createTestUser(`nodelay_${ts}`, email, 'pass123');
    const univ = await createUniverse(reg.token, `NoDelay ${ts}`);
    await seedUniverseSectors(pool, univ.body.universeId);
    const join = await joinUniverse(reg.token, univ.body.universeId, 'Blocked');

    await pool.query(
      `UPDATE players SET ship_destroyed_date = NOW() + INTERVAL '1 hour' WHERE id = $1`,
      [join.body.playerId],
    );

    const result = await wsConnectExpectClose(reg.token, univ.body.universeId);
    assert.equal(result.code, 1008);
    assert.match(result.reason, /destroyed/i);
    assert.match(result.reason, /respawn/i);
  });
});

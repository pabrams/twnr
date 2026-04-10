import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ensureServer, createPool as _gsCreatePool, createTestUserWithToken, BASE } from './global-setup.mjs';

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

// ─── Login after ship destruction ───────────────────────────────────────────

describe('Login after ship destruction', () => {
  it('allows login when ship_destroyed_date is set and delay has passed (default=0)', async () => {
    const ts = Date.now();
    const email = `dest_${ts}@test.com`;
    const reg = await createTestUser(`dest_${ts}`, email, 'pass123');
    const univ = await createUniverse(reg.token, `DestTest ${ts}`);
    await seedUniverseSectors(pool, univ.body.universeId);
    const join = await joinUniverse(reg.token, univ.body.universeId, 'Destroyed');

    // Simulate destruction
    await pool.query('UPDATE players SET ship_destroyed_date = NOW(), ship_id = NULL WHERE id = $1', [join.body.playerId]);
    await pool.query('DELETE FROM ships WHERE owner_id = $1', [join.body.playerId]);

    const login = await loginUser(email, 'pass123');
    assert.equal(login.status, 200);

    const playerRes = await pool.query('SELECT ship_destroyed_date FROM players WHERE id = $1', [join.body.playerId]);
    assert.equal(playerRes.rows[0].ship_destroyed_date, null, 'ship_destroyed_date should be cleared');

    const shipRes = await pool.query('SELECT st.name as ship_name FROM ships s JOIN ship_types st ON s.ship_type_id = st.id WHERE s.id = (SELECT ship_id FROM players WHERE id = $1)', [join.body.playerId]);
    assert.equal(shipRes.rows.length, 1, 'New ship should be created');
    assert.equal(shipRes.rows[0].ship_name, 'Vulpeculan Cruiser');

    const creditsRes = await pool.query('SELECT credits FROM players WHERE id = $1', [join.body.playerId]);
    assert.equal(creditsRes.rows[0].credits, 10000);
  });

  it('returns 403 when delay has not passed', async () => {
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

    const login = await loginUser(email, 'pass123');
    assert.equal(login.status, 403);
    assert.ok(
      login.body.error && login.body.error.toLowerCase().includes('destroyed'),
      `Error should mention "destroyed", got: ${login.body.error}`,
    );
  });
});

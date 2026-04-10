import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ensureServer, createPool as _gsCreatePool, createTestUserWithToken, BASE, WS_BASE } from './global-setup.mjs';
import { ClientMsgType, ServerMsgType } from '@twnr/shared';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function createTestUser(name, email, password) {
  const { userId, token } = await createTestUserWithToken(pool, { name, email, password });
  return { status: 201, body: { userId }, token };
}

async function connectWS(token, universeId) {
  const { default: WebSocket } = await import('ws');
  const headers = { Cookie: `twnr_auth=${token}` };
  const url = `${WS_BASE}/ws?universe=${universeId}`;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('WS connect timeout')); }, 2000);

    ws.on('message', (data) => {
      const raw = JSON.parse(data.toString());
      const msg = raw.payload ?? raw;
      if (msg.type === ServerMsgType.Welcome) {
        clearTimeout(timer);
        resolve({ ws, welcome: msg });
      }
    });
    ws.on('error', (err) => { clearTimeout(timer); reject(err); });
    ws.on('close', (code) => {
      clearTimeout(timer);
      reject(new Error(`WS closed with code ${code}`));
    });
  });
}

function closeWS(ws) {
  return new Promise((resolve) => {
    if (!ws || ws.readyState > 1) { resolve(); return; }
    ws.on('close', resolve);
    ws.close();
    setTimeout(resolve, 1000);
  });
}

function wsRequest(ws, msg, responseType, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for "${responseType}"`)), timeout);
    function handler(data) {
      const raw = JSON.parse(data.toString());
      const parsed = raw.payload ?? raw;
      if (parsed.type === responseType || parsed.type === ServerMsgType.Error) {
        clearTimeout(timer);
        ws.removeListener('message', handler);
        resolve(parsed);
      }
    }
    ws.on('message', handler);
    ws.send(JSON.stringify(msg));
  });
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

// ─── 7. WebSocket scoping ───────────────────────────────────────────────────

describe('WebSocket universe scoping', () => {
  it('connects successfully when user has a player in the specified universe', async () => {
    const ts = Date.now();
    const reg = await createTestUser(`wsok_${ts}`, `wsok_${ts}@test.com`, 'pass123');
    const univ = await createUniverse(reg.token, `WSTest ${ts}`);
    await seedUniverseSectors(pool, univ.body.universeId);
    await joinUniverse(reg.token, univ.body.universeId, 'WSPlayer');

    const { ws, welcome } = await connectWS(reg.token, univ.body.universeId);
    assert.ok(welcome, 'Should receive welcome message');
    assert.equal(welcome.type, ServerMsgType.Welcome);
    await closeWS(ws);
  });

  it('rejects WebSocket when no universe parameter is provided', async () => {
    const ts = Date.now();
    const reg = await createTestUser(`wsnouniv_${ts}`, `wsnouniv_${ts}@test.com`, 'pass123');
    const { default: WebSocket } = await import('ws');

    const ws = new WebSocket(`${WS_BASE}/ws`, {
      headers: { Cookie: `twnr_auth=${reg.token}` },
    });

    const result = await new Promise((resolve) => {
      ws.on('open', () => {
        // If it opens but then closes, that's also a rejection
        setTimeout(() => { ws.terminate(); resolve('stayed_open'); }, 500);
      });
      ws.on('close', (code) => resolve(`closed_${code}`));
      ws.on('error', () => resolve('error'));
      setTimeout(() => { ws.terminate(); resolve('timeout'); }, 1500);
    });

    assert.notEqual(result, 'stayed_open', 'WebSocket should be rejected without universe parameter');
  });

  it('rejects WebSocket when user has no player in specified universe', async () => {
    const ts = Date.now();
    const reg = await createTestUser(`wsnojoin_${ts}`, `wsnojoin_${ts}@test.com`, 'pass123');
    const univ = await createUniverse(reg.token, `NoJoin ${ts}`);
    // Don't join the universe
    const { default: WebSocket } = await import('ws');

    const ws = new WebSocket(`${WS_BASE}/ws?universe=${univ.body.universeId}`, {
      headers: { Cookie: `twnr_auth=${reg.token}` },
    });

    const result = await new Promise((resolve) => {
      ws.on('open', () => {
        setTimeout(() => { ws.terminate(); resolve('stayed_open'); }, 500);
      });
      ws.on('close', (code) => resolve(`closed_${code}`));
      ws.on('error', () => resolve('error'));
      setTimeout(() => { ws.terminate(); resolve('timeout'); }, 1500);
    });

    assert.notEqual(result, 'stayed_open', 'WebSocket should be rejected when user has no player in universe');
  });

  it('sector display only shows data from the connected universe', async () => {
    const ts = Date.now();
    const reg = await createTestUser(`scope_${ts}`, `scope_${ts}@test.com`, 'pass123');

    // Create two universes with different sector data
    const univA = await createUniverse(reg.token, `ScopeA ${ts}`);
    const univB = await createUniverse(reg.token, `ScopeB ${ts}`);

    // Universe A: sectors 1-5
    await seedUniverseSectors(pool, univA.body.universeId, 5);
    // Universe B: sectors 1-3 (fewer sectors, different warps)
    await seedUniverseSectors(pool, univB.body.universeId, 3);

    await joinUniverse(reg.token, univA.body.universeId, 'PlayerA');
    await joinUniverse(reg.token, univB.body.universeId, 'PlayerB');

    // Connect to universe A and check warps
    const { ws: wsA } = await connectWS(reg.token, univA.body.universeId);
    const dispA = await wsRequest(wsA, { type: ClientMsgType.SectorDisplay }, ServerMsgType.SectorDisplayResult);
    assert.equal(dispA.type, ServerMsgType.SectorDisplayResult);
    assert.equal(dispA.sector, 1, 'Should be in sector 1');
    // Universe A has sector 2 as a warp from sector 1
    assert.ok(dispA.warps.some(w => w.sector === 2), 'Universe A sector 1 should have warp to sector 2');
    await closeWS(wsA);

    // Connect to universe B and verify it sees universe B's warps, not A's
    const { ws: wsB } = await connectWS(reg.token, univB.body.universeId);
    const dispB = await wsRequest(wsB, { type: ClientMsgType.SectorDisplay }, ServerMsgType.SectorDisplayResult);
    assert.equal(dispB.type, ServerMsgType.SectorDisplayResult);
    assert.equal(dispB.sector, 1);
    // Universe B has sectors 1-3, so sector 1 should NOT have warp to sector 4 or 5
    for (const w of dispB.warps) {
      assert.ok(w.sector >= 1 && w.sector <= 3, `Universe B sector 1 warp ${w.sector} should be within sectors 1-3`);
    }
    await closeWS(wsB);
  });

  it('player broadcasts are isolated to the same universe and sector', async () => {
    const ts = Date.now();

    // Create two users
    const user1 = await createTestUser(`bcast1_${ts}`, `bcast1_${ts}@test.com`, 'pass123');
    const user2 = await createTestUser(`bcast2_${ts}`, `bcast2_${ts}@test.com`, 'pass123');
    const user3 = await createTestUser(`bcast3_${ts}`, `bcast3_${ts}@test.com`, 'pass123');

    // Create two universes
    const univA = await createUniverse(user1.token, `BcastA ${ts}`);
    const univB = await createUniverse(user1.token, `BcastB ${ts}`);
    await seedUniverseSectors(pool, univA.body.universeId, 5);
    await seedUniverseSectors(pool, univB.body.universeId, 5);

    // user1 and user2 join universe A; user3 joins universe B
    await joinUniverse(user1.token, univA.body.universeId, 'Player1A');
    await joinUniverse(user2.token, univA.body.universeId, 'Player2A');
    await joinUniverse(user3.token, univB.body.universeId, 'Player3B');

    // All start in sector 1. Connect all three.
    const { ws: ws1 } = await connectWS(user1.token, univA.body.universeId);
    const { ws: ws2 } = await connectWS(user2.token, univA.body.universeId);
    const { ws: ws3 } = await connectWS(user3.token, univB.body.universeId);

    // Collect messages on ws2 (same universe as ws1) and ws3 (different universe)
    const ws2Messages = [];
    const ws3Messages = [];
    ws2.on('message', (data) => { const raw = JSON.parse(data.toString()); ws2Messages.push(raw.payload ?? raw); });
    ws3.on('message', (data) => { const raw = JSON.parse(data.toString()); ws3Messages.push(raw.payload ?? raw); });

    // user1 moves from sector 1 to sector 2 in universe A
    await wsRequest(ws1, { type: ClientMsgType.Move, sector: 2 }, ServerMsgType.MoveResult);

    // Give time for broadcasts to propagate
    await new Promise((resolve) => setTimeout(resolve, 100));

    // ws2 (same universe, was in same sector) should have received a broadcast
    const ws2Relevant = ws2Messages.filter(m => m.type === ServerMsgType.PlayerLeft || m.type === ServerMsgType.PlayerMoved);
    assert.ok(ws2Relevant.length > 0, 'Player in same universe+sector should receive movement broadcast');

    // ws3 (different universe) should NOT have received any movement broadcast
    const ws3Relevant = ws3Messages.filter(m => m.type === ServerMsgType.PlayerLeft || m.type === ServerMsgType.PlayerMoved);
    assert.equal(ws3Relevant.length, 0, 'Player in different universe should NOT receive movement broadcast');

    await closeWS(ws1);
    await closeWS(ws2);
    await closeWS(ws3);
  });
});

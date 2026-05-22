import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { connectWS, closeWS, wsRequest, waitForMsg } from './helpers.mjs';
import { ensureServer, createPool } from './global-setup.mjs';
import { adminKeyPost, adminKeyDelete } from './admin-helpers.mjs';
import { ClientTag, ServerTag } from '@twnr/shared';

const DEFAULT_UNIVERSE_ID = 1;

let pool;

before(async () => {
  await ensureServer();
  pool = createPool();
});

after(async () => {
  if (pool) await pool.end();
});

/** Drain messages until the ws is quiet. Used to ignore async pushes. */
function drain(ws, ms = 100) {
  return new Promise((resolve) => {
    let last = Date.now();
    function handler() { last = Date.now(); }
    ws.on('message', handler);
    const interval = setInterval(() => {
      if (Date.now() - last >= ms) {
        clearInterval(interval);
        ws.removeListener('message', handler);
        resolve();
      }
    }, 20);
    setTimeout(() => { clearInterval(interval); ws.removeListener('message', handler); resolve(); }, 800);
  });
}

/** Request a neighborhood crop with a square viewport of `halfExtent` world units. */
function requestNeighborhood(ws, halfExtent = 600) {
  return wsRequest(
    ws,
    {
      type: ClientTag.GetNeighborhood,
      halfWidthWorld: halfExtent,
      halfHeightWorld: halfExtent,
    },
    ServerTag.NeighborhoodResult,
  );
}

describe('GET_NEIGHBORHOOD wire protocol', () => {
  let randomUniverseId;

  before(async () => {
    // The default universe (id=DEFAULT_UNIVERSE_ID) is now proximal; spin up
    // a dedicated random-topology universe so we can exercise the empty-
    // payload code path without depending on the default's topology.
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: `RandTest_${Date.now()}`, sectors: 50, seed: 7, topology: 'random',
    });
    assert.equal(res.status, 201, `generate failed: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.topology, 'random');
    randomUniverseId = res.body.id;
  });

  after(async () => {
    if (randomUniverseId) {
      await adminKeyDelete(`/api/admin/universes/${randomUniverseId}`);
    }
  });

  it('returns empty payload with topology=random in a random universe', async () => {
    const { ws } = await connectWS({ pool, universeId: randomUniverseId });
    try {
      const msg = await requestNeighborhood(ws, 3);
      assert.equal(msg.type, ServerTag.NeighborhoodResult);
      assert.equal(msg.topology, 'random');
      assert.deepStrictEqual(msg.sectors, []);
      assert.deepStrictEqual(msg.warps, []);
    } finally {
      await closeWS(ws);
    }
  });

  it('rejects non-numeric viewport extents at the wire layer', async () => {
    const { ws } = await connectWS({ pool, universeId: DEFAULT_UNIVERSE_ID });
    try {
      const msg = await wsRequest(
        ws,
        { type: ClientTag.GetNeighborhood, halfWidthWorld: 'big', halfHeightWorld: 600 },
        ServerTag.NeighborhoodResult,
      );
      assert.equal(msg.type, ServerTag.Error);
      assert.match(msg.message, /halfWidthWorld and halfHeightWorld must be numbers/i);
    } finally {
      await closeWS(ws);
    }
  });
});

describe('GET_NEIGHBORHOOD in a proximal universe', () => {
  let proxUniverseId;
  let universeName;

  before(async () => {
    universeName = `ProxTest_${Date.now()}`;
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: universeName, sectors: 200, seed: 123, twoWayPct: 95, topology: 'proximal',
    });
    assert.equal(res.status, 201, `generate failed: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.topology, 'proximal');
    proxUniverseId = res.body.id;
  });

  after(async () => {
    if (proxUniverseId) {
      await adminKeyDelete(`/api/admin/universes/${proxUniverseId}`);
    }
  });

  async function makePlayerInUniverse(label) {
    // Create a user, create a player via HTTP (join universe API).
    const { createTestUserWithToken } = await import('./global-setup.mjs');
    const { token } = await createTestUserWithToken(pool, { name: label });
    // Join the universe via the API (POST /api/universes/:id/join).
    const res = await fetch(`http://localhost:${process.env.PORT || 3001}/api/universes/${proxUniverseId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `twnr_auth=${token}` },
      body: JSON.stringify({ name: label }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(`join failed: ${res.status} ${JSON.stringify(body)}`);
    }
    return { token };
  }

  async function connect(label) {
    const { token } = await makePlayerInUniverse(label);
    const { ws, welcome } = await connectWS({ token, universeId: proxUniverseId });
    return { ws, welcome };
  }

  it('at spawn, returns current sector with visibility=visited and glimpsed warp targets', async () => {
    const { ws, welcome } = await connect(`P1_${Date.now()}`);
    try {
      await drain(ws);
      const msg = await requestNeighborhood(ws, 3);
      assert.equal(msg.topology, 'proximal');
      const current = msg.sectors.find((s) => s.id === msg.current_sector_id);
      assert.ok(current, 'neighborhood must include current sector');
      assert.equal(current.visibility, 'visited');
      assert.equal(current.sector_number, welcome.sector);
      // Glimpsed-only sectors must have null port and empty planets.
      for (const s of msg.sectors) {
        if (s.visibility === 'glimpsed') {
          assert.equal(s.port, null, `glimpsed sector ${s.sector_number} leaks port`);
          assert.deepStrictEqual(s.planets, [], `glimpsed sector ${s.sector_number} leaks planets`);
        }
      }
    } finally {
      await closeWS(ws);
    }
  });

  it('two players with different exploration histories get different payloads', async () => {
    const p1 = await connect(`A_${Date.now()}`);
    const p2 = await connect(`B_${Date.now() + 1}`);
    try {
      await drain(p1.ws); await drain(p2.ws);
      // Move p1 one hop.
      const warps1 = await wsRequest(p1.ws, { type: ClientTag.WarpsOut, id: p1.welcome.sector }, ServerTag.WarpsOutResult);
      const nextSector = warps1.warps[0].sector;
      await wsRequest(p1.ws, { type: ClientTag.Move, sector: nextSector }, ServerTag.MoveResult);
      await drain(p1.ws);

      const nbh1 = await requestNeighborhood(p1.ws, 3);
      const nbh2 = await requestNeighborhood(p2.ws, 3);
      const p1Visited = new Set(nbh1.sectors.filter((s) => s.visibility === 'visited').map((s) => s.sector_number));
      const p2Visited = new Set(nbh2.sectors.filter((s) => s.visibility === 'visited').map((s) => s.sector_number));
      assert.ok(p1Visited.has(nextSector), 'p1 should have visited the new sector');
      assert.ok(!p2Visited.has(nextSector) || p2.welcome.sector === nextSector,
        'p2 should not have visited p1\'s new sector');
      // Neither response includes port/planet data for glimpsed-only sectors.
      for (const m of [nbh1, nbh2]) {
        for (const s of m.sectors) {
          if (s.visibility === 'glimpsed') {
            assert.equal(s.port, null);
            assert.deepStrictEqual(s.planets, []);
          }
        }
      }
    } finally {
      await closeWS(p1.ws); await closeWS(p2.ws);
    }
  });

  it('viewport extent clamping: out-of-range numeric extents are clamped without erroring', async () => {
    const { ws } = await connect(`P_Clamp_${Date.now()}`);
    try {
      await drain(ws);
      // Negative → clamped to default.
      const m1 = await requestNeighborhood(ws, -10);
      assert.equal(m1.type, ServerTag.NeighborhoodResult);
      // Below MIN_HALF_EXTENT (50) → clamped up to MIN.
      const m2 = await requestNeighborhood(ws, 5);
      assert.equal(m2.type, ServerTag.NeighborhoodResult);
      // Above MAX_HALF_EXTENT (1_000_000) → clamped down to MAX.
      const m3 = await requestNeighborhood(ws, 5_000_000);
      assert.equal(m3.type, ServerTag.NeighborhoodResult);
    } finally {
      await closeWS(ws);
    }
  });
});

describe('Per-player observation snapshots', () => {
  it('records visited + port observation when a sector is displayed', async () => {
    const { ws, welcome } = await connectWS({ pool, universeId: DEFAULT_UNIVERSE_ID });
    try {
      // Hydrate: trigger a sector display to force an observation record.
      await wsRequest(ws, { type: ClientTag.SectorDisplay }, ServerTag.SectorDisplayResult);
      // Look up player id from the welcome.
      const pid = welcome.playerId;
      const res = await pool.query(
        `SELECT pvs.player_id, s.sector_number
         FROM player_visited_sectors pvs
         JOIN sectors s ON pvs.sector_id = s.id
         WHERE pvs.player_id = $1 AND s.sector_number = $2`,
        [pid, welcome.sector],
      );
      assert.ok(res.rows.length >= 1, 'player_visited_sectors should have a row after sector display');
    } finally {
      await closeWS(ws);
    }
  });
});

// Silence unused import warning.
void waitForMsg;

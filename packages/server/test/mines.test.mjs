import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { connectWS, closeWS, wsRequest, createTestUser } from './helpers.mjs';
import { ensureServer, createPool } from './global-setup.mjs';
import { ClientTag, ServerTag } from '@twnr/shared';

const UNIVERSE_ID = 1;

let pool;

function ws(opts = {}) {
  return connectWS({ pool, universeId: UNIVERSE_ID, ...opts });
}

async function findAdjacentSector(startSector) {
  const res = await pool.query(
    `SELECT to_s.sector_number AS adj
     FROM warps w
     JOIN sectors from_s ON w.from_sector_id = from_s.id
     JOIN sectors to_s ON w.to_sector_id = to_s.id
     WHERE from_s.sector_number = $1 AND from_s.universe_id = $2
     LIMIT 1`,
    [startSector, UNIVERSE_ID],
  );
  return res.rows[0]?.adj;
}

async function getPlayerByName(name) {
  const res = await pool.query('SELECT id, ship_id, current_sector_id FROM players WHERE name = $1', [name]);
  return res.rows[0];
}

async function setShipHardware(shipId, itemName, quantity) {
  await pool.query(
    `INSERT INTO ship_hardware (ship_id, hardware_item_id, quantity)
     VALUES ($1, (SELECT id FROM hardware_item WHERE name = $2), $3)
     ON CONFLICT (ship_id, hardware_item_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
    [shipId, itemName, quantity],
  );
}

async function getShipHardware(shipId, itemName) {
  const res = await pool.query(
    `SELECT COALESCE(sh.quantity, 0) AS quantity
     FROM hardware_item hi
     LEFT JOIN ship_hardware sh ON sh.ship_id = $1 AND sh.hardware_item_id = hi.id
     WHERE hi.name = $2`,
    [shipId, itemName],
  );
  return res.rows[0]?.quantity ?? 0;
}

async function getSectorMine(sectorNumber, mineType) {
  const res = await pool.query(
    `SELECT sm.quantity, sm.owner_player_id FROM sector_mines sm
     JOIN sectors s ON sm.sector_id = s.id
     WHERE s.sector_number = $1 AND s.universe_id = $2 AND sm.mine_type = $3`,
    [sectorNumber, UNIVERSE_ID, mineType],
  );
  return res.rows[0];
}

async function setSectorMine(sectorNumber, mineType, ownerPlayerId, quantity) {
  await pool.query(
    `INSERT INTO sector_mines (sector_id, mine_type, owner_player_id, quantity)
     VALUES ((SELECT id FROM sectors WHERE sector_number = $1 AND universe_id = $2), $3, $4, $5)
     ON CONFLICT (sector_id, mine_type) DO UPDATE
     SET owner_player_id = EXCLUDED.owner_player_id, quantity = EXCLUDED.quantity`,
    [sectorNumber, UNIVERSE_ID, mineType, ownerPlayerId, quantity],
  );
}

async function clearSectorMines(sectorNumber) {
  await pool.query(
    `DELETE FROM sector_mines WHERE sector_id = (SELECT id FROM sectors WHERE sector_number = $1 AND universe_id = $2)`,
    [sectorNumber, UNIVERSE_ID],
  );
}

async function getSeekerAttachment(shipId) {
  const res = await pool.query(
    'SELECT ship_id, owner_player_id FROM seeker_attachments WHERE ship_id = $1',
    [shipId],
  );
  return res.rows[0];
}

async function setUniverseMineSettings(overrides) {
  const cols = Object.keys(overrides);
  if (cols.length === 0) return;
  const sets = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
  const values = cols.map((c) => overrides[c]);
  await pool.query(
    `UPDATE universe_settings SET ${sets} WHERE universe_id = $${cols.length + 1}`,
    [...values, UNIVERSE_ID],
  );
}

before(async () => {
  await ensureServer();
  pool = createPool();
});

after(async () => {
  if (!pool) return;
  // Restore universe-mine settings to defaults so later test files (which
  // share this universe) don't see e.g. proximity_detonation_pct=100.
  // Values mirror universeConfig in src/universe-config.ts.
  await pool.query(
    `UPDATE universe_settings
     SET proximity_mine_damage = 100,
         proximity_detonation_pct = 50,
         seeker_attach_pct = 25,
         seeker_pickup_detect_pct = 80,
         mine_disruptor_min = 3,
         mine_disruptor_max = 5
     WHERE universe_id = $1`,
    [UNIVERSE_ID],
  );
  // Clear any leftover deployed mines / attachments in this universe.
  await pool.query(
    `DELETE FROM sector_mines WHERE sector_id IN (SELECT id FROM sectors WHERE universe_id = $1)`,
    [UNIVERSE_ID],
  );
  await pool.query(
    `DELETE FROM seeker_attachments WHERE ship_id IN (
       SELECT s.id FROM ships s
       JOIN players p ON p.ship_id = s.id
       WHERE p.universe_id = $1)`,
    [UNIVERSE_ID],
  );
  await pool.end();
});

describe('Mine schema', () => {
  it('sector_mines CHECK only allows proximity and seeker', async () => {
    const res = await pool.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = 'sector_mines'::regclass AND contype = 'c'
         AND pg_get_constraintdef(oid) ILIKE '%mine_type%'`,
    );
    const def = res.rows.map((r) => r.def).join('\n');
    assert.match(def, /proximity/);
    assert.match(def, /seeker/);
    assert.doesNotMatch(def, /orbital/i);
  });

  it('orbital_mine hardware item has been removed', async () => {
    const res = await pool.query(`SELECT id FROM hardware_item WHERE name = 'orbital_mine'`);
    assert.equal(res.rowCount, 0);
  });

  it('seeker_attachments table exists', async () => {
    const res = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'seeker_attachments'`,
    );
    assert.equal(res.rowCount, 1);
  });

  it('universe_settings has mine columns', async () => {
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'universe_settings'`,
    );
    const cols = new Set(res.rows.map((r) => r.column_name));
    for (const c of [
      'proximity_mine_damage',
      'proximity_detonation_pct',
      'seeker_attach_pct',
      'seeker_pickup_detect_pct',
      'mine_disruptor_min',
      'mine_disruptor_max',
    ]) {
      assert.ok(cols.has(c), `missing ${c}`);
    }
  });
});

describe('Deploy mines', () => {
  let attackerWs, attackerName;
  let attackerPlayer;

  beforeEach(async () => {
    attackerName = `MineDeployer_${Date.now()}_${Math.random()}`;
    const conn = await connectWS({ pool, universeId: UNIVERSE_ID });
    attackerWs = conn.ws;
    attackerName = conn.welcome.name;
    attackerPlayer = await getPlayerByName(attackerName);
    // Clean up any leftover state.
    await clearSectorMines(1);
    await pool.query('DELETE FROM seeker_attachments WHERE ship_id = $1', [attackerPlayer.ship_id]);
  });

  it('deploys proximity mines and removes them from the ship', async () => {
    await setShipHardware(attackerPlayer.ship_id, 'proximity_mine', 10);
    const res = await wsRequest(
      attackerWs,
      { type: ClientTag.DeployMine, mineType: 'proximity', quantity: 5 },
      ServerTag.DeployMineResult,
    );
    assert.equal(res.type, ServerTag.DeployMineResult);
    assert.equal(res.deployed, 5);
    assert.equal(res.shipRemaining, 5);
    assert.equal(res.sectorTotal, 5);

    const remaining = await getShipHardware(attackerPlayer.ship_id, 'proximity_mine');
    assert.equal(remaining, 5);

    const sectorRow = await getSectorMine(1, 'proximity');
    assert.ok(sectorRow);
    assert.equal(sectorRow.quantity, 5);
    assert.equal(sectorRow.owner_player_id, attackerPlayer.id);
    await closeWS(attackerWs);
  });

  it('rejects deploying when sector contains hostile mines of same type', async () => {
    await setShipHardware(attackerPlayer.ship_id, 'proximity_mine', 5);
    // Create another player to own the existing mines.
    const { userId } = await createTestUser(pool);
    const otherRes = await pool.query(
      `INSERT INTO players (name, user_id, universe_id, current_sector_id, credits, turns)
       VALUES ($1, $2, $3, (SELECT id FROM sectors WHERE sector_number = 1 AND universe_id = $3), 10000, 100)
       RETURNING id`,
      [`OtherOwner_${Date.now()}`, userId, UNIVERSE_ID],
    );
    const otherId = otherRes.rows[0].id;
    await setSectorMine(1, 'proximity', otherId, 10);

    const res = await wsRequest(
      attackerWs,
      { type: ClientTag.DeployMine, mineType: 'proximity', quantity: 1 },
      ServerTag.DeployMineResult,
    );
    assert.equal(res.type, ServerTag.Error);
    await pool.query('DELETE FROM players WHERE id = $1', [otherId]);
    await closeWS(attackerWs);
  });

  it('rejects deploying more mines than the ship has', async () => {
    await setShipHardware(attackerPlayer.ship_id, 'seeker_mine', 2);
    const res = await wsRequest(
      attackerWs,
      { type: ClientTag.DeployMine, mineType: 'seeker', quantity: 5 },
      ServerTag.DeployMineResult,
    );
    assert.equal(res.type, ServerTag.Error);
    await closeWS(attackerWs);
  });

  it('lists all deployed mines for a player', async () => {
    await setShipHardware(attackerPlayer.ship_id, 'proximity_mine', 5);
    await setShipHardware(attackerPlayer.ship_id, 'seeker_mine', 5);
    await wsRequest(
      attackerWs,
      { type: ClientTag.DeployMine, mineType: 'proximity', quantity: 3 },
      ServerTag.DeployMineResult,
    );
    await wsRequest(
      attackerWs,
      { type: ClientTag.DeployMine, mineType: 'seeker', quantity: 2 },
      ServerTag.DeployMineResult,
    );
    const res = await wsRequest(
      attackerWs,
      { type: ClientTag.ListDeployedMines },
      ServerTag.ListDeployedMinesResult,
    );
    assert.equal(res.type, ServerTag.ListDeployedMinesResult);
    const types = res.mines.map((m) => m.mineType).sort();
    assert.deepEqual(types, ['proximity', 'seeker']);
    const prox = res.mines.find((m) => m.mineType === 'proximity');
    assert.equal(prox.quantity, 3);
    const seek = res.mines.find((m) => m.mineType === 'seeker');
    assert.equal(seek.quantity, 2);
    await closeWS(attackerWs);
  });
});

describe('Mine disruptor', () => {
  it('disruptor removes a deterministic count of proximity mines', async () => {
    const { ws: wsConn, welcome } = await connectWS({ pool, universeId: UNIVERSE_ID });
    const attacker = await getPlayerByName(welcome.name);

    // Lock the disruptor to remove exactly 4 mines.
    await setUniverseMineSettings({ mine_disruptor_min: 4, mine_disruptor_max: 4 });
    await setShipHardware(attacker.ship_id, 'mine_disruptor', 3);

    // Find an adjacent sector.
    const adj = await findAdjacentSector(1);
    assert.ok(adj, 'expected adjacent sector');

    // Seed the adjacent sector with hostile proximity mines (different owner).
    const { userId } = await createTestUser(pool);
    const otherRes = await pool.query(
      `INSERT INTO players (name, user_id, universe_id, current_sector_id, credits, turns)
       VALUES ($1, $2, $3, (SELECT id FROM sectors WHERE sector_number = $4 AND universe_id = $3), 0, 0)
       RETURNING id`,
      [`MineLayer_${Date.now()}`, userId, UNIVERSE_ID, adj],
    );
    await setSectorMine(adj, 'proximity', otherRes.rows[0].id, 10);

    const res = await wsRequest(
      wsConn,
      { type: ClientTag.MineDisruptor, targetSector: adj },
      ServerTag.MineDisruptorResult,
    );
    assert.equal(res.type, ServerTag.MineDisruptorResult);
    assert.equal(res.minesDisrupted, 4);
    assert.equal(res.proximityMinesRemaining, 6);

    // Disruptor consumed.
    const left = await getShipHardware(attacker.ship_id, 'mine_disruptor');
    assert.equal(left, 2);

    // Cleanup
    await clearSectorMines(adj);
    await pool.query('DELETE FROM players WHERE id = $1', [otherRes.rows[0].id]);
    await closeWS(wsConn);
  });

  it('disruptor rejects non-adjacent target', async () => {
    const { ws: wsConn, welcome } = await connectWS({ pool, universeId: UNIVERSE_ID });
    const attacker = await getPlayerByName(welcome.name);
    await setShipHardware(attacker.ship_id, 'mine_disruptor', 1);

    // 99999 is not a real sector and definitely not adjacent.
    const res = await wsRequest(
      wsConn,
      { type: ClientTag.MineDisruptor, targetSector: 99999 },
      ServerTag.MineDisruptorResult,
    );
    assert.equal(res.type, ServerTag.Error);
    await closeWS(wsConn);
  });
});

describe('Proximity mine detonation on entry', () => {
  it('forced 100% detonation damages the entering ship', async () => {
    const { ws: wsConn, welcome } = await connectWS({ pool, universeId: UNIVERSE_ID });
    const attacker = await getPlayerByName(welcome.name);
    // Start at sector 1; pick an adjacent sector and seed it with mines.
    const adj = await findAdjacentSector(1);
    assert.ok(adj);

    await setUniverseMineSettings({
      proximity_detonation_pct: 100,
      proximity_mine_damage: 10,
    });
    await pool.query('UPDATE ships SET shields = 100, drones = 100 WHERE id = $1', [
      attacker.ship_id,
    ]);

    // Hostile mine layer.
    const { userId } = await createTestUser(pool);
    const otherRes = await pool.query(
      `INSERT INTO players (name, user_id, universe_id, current_sector_id, credits, turns)
       VALUES ($1, $2, $3, NULL, 0, 0)
       RETURNING id`,
      [`Hostile_${Date.now()}`, userId, UNIVERSE_ID],
    );
    await setSectorMine(adj, 'proximity', otherRes.rows[0].id, 3);

    // Move into the sector. Listen for ProximityMineHit.
    const hitPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no hit event')), 3000);
      function handler(data) {
        const raw = JSON.parse(data.toString());
        const msg = raw.payload ?? raw;
        if (msg.type === ServerTag.ProximityMineHit) {
          clearTimeout(timer);
          wsConn.removeListener('message', handler);
          resolve(msg);
        }
      }
      wsConn.on('message', handler);
    });

    await wsRequest(
      wsConn,
      { type: ClientTag.Move, sector: adj },
      ServerTag.MoveResult,
    );

    const hit = await hitPromise;
    assert.equal(hit.detonations, 3);
    assert.equal(hit.damage, 30);
    assert.equal(hit.shieldsLost, 30);
    assert.equal(hit.dronesLost, 0);
    assert.equal(hit.destroyed, false);

    // Mines that detonated should be gone.
    const mineRow = await getSectorMine(adj, 'proximity');
    assert.equal(mineRow, undefined);

    // Cleanup
    await pool.query('DELETE FROM players WHERE id = $1', [otherRes.rows[0].id]);
    await closeWS(wsConn);
  });

  it('player does not detonate their own proximity mines', async () => {
    const { ws: wsConn, welcome } = await connectWS({ pool, universeId: UNIVERSE_ID });
    const me = await getPlayerByName(welcome.name);
    const adj = await findAdjacentSector(1);
    assert.ok(adj);

    await setUniverseMineSettings({
      proximity_detonation_pct: 100,
      proximity_mine_damage: 999,
    });
    await pool.query('UPDATE ships SET shields = 50, drones = 50 WHERE id = $1', [me.ship_id]);
    await setSectorMine(adj, 'proximity', me.id, 5);

    await wsRequest(
      wsConn,
      { type: ClientTag.Move, sector: adj },
      ServerTag.MoveResult,
    );

    // Ship survived: shields and drones intact.
    const r = await pool.query('SELECT shields, drones FROM ships WHERE id = $1', [me.ship_id]);
    assert.equal(r.rows[0].shields, 50);
    assert.equal(r.rows[0].drones, 50);
    await clearSectorMines(adj);
    await closeWS(wsConn);
  });
});

describe('Seeker mine attach/drop', () => {
  it('forced 100% attach attaches a seeker mine to the entering ship', async () => {
    const { ws: wsConn, welcome } = await connectWS({ pool, universeId: UNIVERSE_ID });
    const me = await getPlayerByName(welcome.name);
    const adj = await findAdjacentSector(1);
    assert.ok(adj);

    await setUniverseMineSettings({
      seeker_attach_pct: 100,
      seeker_pickup_detect_pct: 0,
    });

    const { userId } = await createTestUser(pool);
    const otherRes = await pool.query(
      `INSERT INTO players (name, user_id, universe_id, current_sector_id, credits, turns)
       VALUES ($1, $2, $3, NULL, 0, 0)
       RETURNING id`,
      [`SeekerLayer_${Date.now()}`, userId, UNIVERSE_ID],
    );
    const layerId = otherRes.rows[0].id;
    await setSectorMine(adj, 'seeker', layerId, 1);

    await wsRequest(
      wsConn,
      { type: ClientTag.Move, sector: adj },
      ServerTag.MoveResult,
    );

    // Allow async post-move resolution to flush.
    await new Promise((r) => setTimeout(r, 200));

    const attachment = await getSeekerAttachment(me.ship_id);
    assert.ok(attachment, 'expected a seeker attachment');
    assert.equal(attachment.owner_player_id, layerId);

    // Mine should have been consumed.
    const mineRow = await getSectorMine(adj, 'seeker');
    assert.equal(mineRow, undefined);

    // Track-seeker-mines from layer's perspective shouldn't error.
    await pool.query('DELETE FROM seeker_attachments WHERE ship_id = $1', [me.ship_id]);
    await pool.query('DELETE FROM players WHERE id = $1', [layerId]);
    await closeWS(wsConn);
  });

  it('previous attachment drops off when a new seeker mine attaches', async () => {
    const { ws: wsConn, welcome } = await connectWS({ pool, universeId: UNIVERSE_ID });
    const me = await getPlayerByName(welcome.name);
    const adj = await findAdjacentSector(1);
    assert.ok(adj);

    await setUniverseMineSettings({
      seeker_attach_pct: 100,
      seeker_pickup_detect_pct: 0,
    });

    // Two distinct hostile owners.
    const { userId: u1 } = await createTestUser(pool);
    const { userId: u2 } = await createTestUser(pool);
    const ownerA = (
      await pool.query(
        `INSERT INTO players (name, user_id, universe_id, credits, turns)
         VALUES ($1, $2, $3, 0, 0) RETURNING id`,
        [`SeekerA_${Date.now()}`, u1, UNIVERSE_ID],
      )
    ).rows[0].id;
    const ownerB = (
      await pool.query(
        `INSERT INTO players (name, user_id, universe_id, credits, turns)
         VALUES ($1, $2, $3, 0, 0) RETURNING id`,
        [`SeekerB_${Date.now()}`, u2, UNIVERSE_ID],
      )
    ).rows[0].id;

    // Pre-attach owner A's mine to me.
    await pool.query(
      `INSERT INTO seeker_attachments (ship_id, owner_player_id, attached_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (ship_id) DO UPDATE SET owner_player_id = EXCLUDED.owner_player_id`,
      [me.ship_id, ownerA],
    );

    // Owner B has a seeker mine in adjacent sector.
    await setSectorMine(adj, 'seeker', ownerB, 1);

    await wsRequest(
      wsConn,
      { type: ClientTag.Move, sector: adj },
      ServerTag.MoveResult,
    );
    await new Promise((r) => setTimeout(r, 200));

    const attachment = await getSeekerAttachment(me.ship_id);
    assert.ok(attachment);
    assert.equal(attachment.owner_player_id, ownerB);

    await pool.query('DELETE FROM seeker_attachments WHERE ship_id = $1', [me.ship_id]);
    await pool.query('DELETE FROM players WHERE id IN ($1, $2)', [ownerA, ownerB]);
    await closeWS(wsConn);
  });
});

describe('Track seeker mines', () => {
  it('owner sees attachments they have placed', async () => {
    const { ws: wsConn, welcome } = await connectWS({ pool, universeId: UNIVERSE_ID });
    const owner = await getPlayerByName(welcome.name);

    // Create a victim ship and attach a mine owned by the connected player.
    const { userId } = await createTestUser(pool);
    const victimRes = await pool.query(
      `INSERT INTO players (name, user_id, universe_id, current_sector_id, credits, turns)
       VALUES ($1, $2, $3, (SELECT id FROM sectors WHERE sector_number = 5 AND universe_id = $3), 0, 0)
       RETURNING id`,
      [`Victim_${Date.now()}`, userId, UNIVERSE_ID],
    );
    const victimId = victimRes.rows[0].id;
    const stRes = await pool.query(
      `SELECT id FROM ship_types WHERE name = 'Vulpeculan Cruiser'`,
    );
    const shipRes = await pool.query(
      `INSERT INTO ships (owner_id, ship_type_id, sector_id, drones, shields, holds)
       VALUES ($1, $2, (SELECT id FROM sectors WHERE sector_number = 5 AND universe_id = $3), 0, 0, 5)
       RETURNING id`,
      [victimId, stRes.rows[0].id, UNIVERSE_ID],
    );
    const victimShipId = shipRes.rows[0].id;
    await pool.query('UPDATE players SET ship_id = $1 WHERE id = $2', [victimShipId, victimId]);

    await pool.query(
      `INSERT INTO seeker_attachments (ship_id, owner_player_id, attached_at)
       VALUES ($1, $2, NOW())`,
      [victimShipId, owner.id],
    );

    const res = await wsRequest(
      wsConn,
      { type: ClientTag.TrackSeekerMines },
      ServerTag.TrackSeekerMinesResult,
    );
    assert.equal(res.type, ServerTag.TrackSeekerMinesResult);
    assert.equal(res.targets.length, 1);
    assert.equal(res.targets[0].sectorNumber, 5);
    assert.equal(res.targets[0].targetShipId, victimShipId);

    await pool.query('DELETE FROM seeker_attachments WHERE ship_id = $1', [victimShipId]);
    await pool.query('DELETE FROM ships WHERE id = $1', [victimShipId]);
    await pool.query('DELETE FROM players WHERE id = $1', [victimId]);
    await closeWS(wsConn);
  });
});

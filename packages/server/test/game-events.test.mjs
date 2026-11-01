import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestUser,
  createTestPlayer,
  connectWS,
  closeWS,
  wsRequest,
  waitForMsg,
  httpPost,
} from './helpers.mjs';
import { ensureServer, createPool } from './global-setup.mjs';
import { Commands, Events } from '@twnr/shared';

const UNIVERSE_ID = 1;

let pool;
let serverPool;

before(async () => {
  await ensureServer();
  pool = createPool();
  // Tests that drive hourly-job services directly import from dist and share the server's pool module.
  ({ pool: serverPool } = await import('../dist/db/pool.js'));
});

after(async () => {
  if (pool) await pool.end();
  if (serverPool) await serverPool.end();
});

async function createPlayer(name, sector = 1, drones = 0, shields = 0) {
  const { userId, token } = await createTestUser(pool);
  const playerId = await createTestPlayer(pool, userId, UNIVERSE_ID, name, sector, drones, shields);
  return { id: playerId, token };
}

async function connectPlayer(token) {
  const conn = await connectWS({ token, universeId: UNIVERSE_ID });
  await conn.ready;
  return conn;
}

async function eventsOfKind(kind, predicate = () => true) {
  const res = await pool.query(
    `SELECT id, kind, visibility, payload FROM game_events
     WHERE universe_id = $1 AND kind = $2 ORDER BY id ASC`,
    [UNIVERSE_ID, kind],
  );
  return res.rows.filter((row) => predicate(row.payload));
}

async function sectorDbId(sectorNumber) {
  const res = await pool.query(
    'SELECT id FROM sectors WHERE sector_number = $1 AND universe_id = $2',
    [sectorNumber, UNIVERSE_ID],
  );
  return res.rows[0].id;
}

async function insertPlanet(sectorNumber, name, ownerPlayerId = null) {
  const res = await pool.query(
    `INSERT INTO planets (sector_id, universe_id, universe_planet_number, name, owner_player_id)
     VALUES ($1, $2, (SELECT COALESCE(MAX(universe_planet_number), 0) + 1 FROM planets WHERE universe_id = $2), $3, $4)
     RETURNING id`,
    [await sectorDbId(sectorNumber), UNIVERSE_ID, name, ownerPlayerId],
  );
  return res.rows[0].id;
}

describe('Game events — ship destruction', () => {
  it('records player_ship_destroyed_by_ship_combat only when the ship is actually destroyed', async () => {
    const atk = await createPlayer(`ge_atk_${Date.now()}`, 1, 10, 0);
    const def = await createPlayer(`ge_def_${Date.now()}`, 1, 2, 2);
    const { ws: wsA } = await connectPlayer(atk.token);
    const { ws: wsD } = await connectPlayer(def.token);
    try {
      const survived = await wsRequest(wsA, { type: Commands.AttackShip.name, targetPlayerId: def.id, drones: 1 }, Commands.AttackShip.reply.name);
      assert.equal(survived.destroyed, false);
      assert.equal((await eventsOfKind('player_ship_destroyed_by_ship_combat', (p) => p.victim.playerId === def.id)).length, 0);

      const killed = await wsRequest(wsA, { type: Commands.AttackShip.name, targetPlayerId: def.id, drones: 5 }, Commands.AttackShip.reply.name);
      assert.equal(killed.destroyed, true);

      const events = await eventsOfKind('player_ship_destroyed_by_ship_combat', (p) => p.victim.playerId === def.id);
      assert.equal(events.length, 1);
      assert.equal(events[0].visibility, 'galactic');
      assert.deepEqual(events[0].payload.attacker, { playerId: atk.id, name: await playerName(atk.id) });
      assert.equal(events[0].payload.destroyedShipType.slug, 'Vulpeculan Cruiser');
      assert.equal(events[0].payload.sectorNumber, 1);
    } finally {
      await closeWS(wsA);
      await closeWS(wsD);
    }
  });

  it('records player_ship_destroyed_by_sector_defenses when proximity mines destroy a ship', async () => {
    const victim = await createPlayer(`ge_mined_${Date.now()}`, 1, 0, 0);
    const miner = await createPlayer(`ge_miner_${Date.now()}`, 1, 0, 0);
    const { ws } = await connectPlayer(victim.token);
    let minedSector;
    try {
      const warps = await wsRequest(ws, { type: Commands.WarpsOut.name, id: 1 }, Commands.WarpsOut.reply.name);
      minedSector = warps.warps[0].sector;
      // 40 mines at the default 50% detonation chance: a shieldless, droneless ship cannot survive entry.
      await pool.query(
        `INSERT INTO sector_mines (sector_id, mine_type, quantity, owner_player_id)
         VALUES ($1, 'proximity', 40, $2)
         ON CONFLICT (sector_id, mine_type) DO UPDATE SET quantity = 40, owner_player_id = $2, owner_clan_id = NULL`,
        [await sectorDbId(minedSector), miner.id],
      );

      const hit = waitForMsg(ws, Events.ProximityMineHit.name);
      await wsRequest(ws, { type: Commands.Move.name, sector: minedSector }, Commands.Move.reply.name);
      assert.equal((await hit).destroyed, true);

      const events = await eventsOfKind('player_ship_destroyed_by_sector_defenses', (p) => p.victim.playerId === victim.id);
      assert.equal(events.length, 1);
      assert.equal(events[0].payload.defenseType, 'mines');
      assert.deepEqual(events[0].payload.defenseOwner, { kind: 'player', playerId: miner.id, name: await playerName(miner.id) });
      assert.equal(events[0].payload.sectorNumber, minedSector);
    } finally {
      if (minedSector) await pool.query('DELETE FROM sector_mines WHERE sector_id = $1', [await sectorDbId(minedSector)]);
      await closeWS(ws);
    }
  });
});

describe('Game events — joining and ships', () => {
  it('records player_joined_universe on join and player_issued_ship on first connect', async () => {
    const { userId, token } = await createTestUser(pool);
    const name = `ge_join_${Date.now()}`;
    const joined = await httpPost(`/api/universes/${UNIVERSE_ID}/join`, { name }, { headers: { Cookie: `twnr_auth=${token}` } });
    assert.equal(joined.status, 201);
    const playerId = joined.body.playerId;

    const joinEvents = await eventsOfKind('player_joined_universe', (p) => p.player.playerId === playerId);
    assert.equal(joinEvents.length, 1);
    assert.equal(joinEvents[0].payload.player.name, name);
    assert.equal((await eventsOfKind('player_issued_ship', (p) => p.player.playerId === playerId)).length, 0);

    const { ws } = await connectPlayer(token);
    await closeWS(ws);

    const issued = await eventsOfKind('player_issued_ship', (p) => p.player.playerId === playerId);
    assert.equal(issued.length, 1);
    const ship = await pool.query('SELECT ship_id FROM players WHERE id = $1', [playerId]);
    assert.equal(issued[0].payload.shipId, ship.rows[0].ship_id);
    assert.equal(issued[0].payload.shipType.slug, 'Vulpeculan Cruiser');

    const rejoined = await httpPost(`/api/universes/${UNIVERSE_ID}/join`, { name }, { headers: { Cookie: `twnr_auth=${token}` } });
    assert.equal(rejoined.status, 409);
    assert.equal((await eventsOfKind('player_joined_universe', (p) => p.player.playerId === playerId)).length, 1);
    assert.ok(userId);
  });
});

describe('Game events — clans', () => {
  it('records the clan lifecycle: create, join, kick, leave, disband', async () => {
    const stamp = Date.now();
    const founder = await createPlayer(`ge_founder_${stamp}`);
    const joiner = await createPlayer(`ge_joiner_${stamp}`);
    const kicked = await createPlayer(`ge_kicked_${stamp}`);
    const { ws: wsF } = await connectPlayer(founder.token);
    const { ws: wsJ } = await connectPlayer(joiner.token);
    const { ws: wsK } = await connectPlayer(kicked.token);
    const clanName = `Clan ${stamp}`;
    try {
      const created = await wsRequest(wsF, { type: Commands.ClanCreate.name, name: clanName, password: 'secret' }, Commands.ClanCreate.reply.name);
      const clan = { clanId: created.clanId, clanNumber: created.clanNumber, name: clanName };
      const forClan = (p) => p.clan.clanId === clan.clanId;

      const createdEvents = await eventsOfKind('clan_created', forClan);
      assert.equal(createdEvents.length, 1);
      assert.deepEqual(createdEvents[0].payload.clan, clan);
      assert.equal(createdEvents[0].payload.founder.playerId, founder.id);

      await wsRequest(wsJ, { type: Commands.ClanJoin.name, name: clanName, password: 'secret' }, Commands.ClanJoin.reply.name);
      await wsRequest(wsK, { type: Commands.ClanJoin.name, name: clanName, password: 'secret' }, Commands.ClanJoin.reply.name);
      const joinEvents = await eventsOfKind('player_joined_clan', forClan);
      assert.deepEqual(joinEvents.map((e) => e.payload.player.playerId), [joiner.id, kicked.id]);

      await wsRequest(wsF, { type: Commands.ClanDropMember.name, targetPlayerId: kicked.id }, Commands.ClanDropMember.reply.name);
      const kickEvents = await eventsOfKind('player_kicked_from_clan', forClan);
      assert.equal(kickEvents.length, 1);
      assert.equal(kickEvents[0].payload.player.playerId, kicked.id);
      assert.equal(kickEvents[0].payload.kickedBy.playerId, founder.id);

      await wsRequest(wsF, { type: Commands.ClanLeave.name, successorPlayerId: joiner.id }, Commands.ClanLeave.reply.name);
      const leftEvents = await eventsOfKind('player_left_clan', forClan);
      assert.deepEqual(leftEvents.map((e) => e.payload.player.playerId), [founder.id]);
      assert.equal((await eventsOfKind('clan_disbanded', forClan)).length, 0);

      const dissolved = await wsRequest(wsJ, { type: Commands.ClanLeave.name, confirmDissolve: true }, Commands.ClanLeave.reply.name);
      assert.equal(dissolved.outcome, 'dissolved');
      assert.deepEqual((await eventsOfKind('player_left_clan', forClan)).map((e) => e.payload.player.playerId), [founder.id, joiner.id]);
      const disbandEvents = await eventsOfKind('clan_disbanded', forClan);
      assert.equal(disbandEvents.length, 1);
      assert.deepEqual(disbandEvents[0].payload.clan, clan);
      assert.equal(disbandEvents[0].payload.lastMember.playerId, joiner.id);
    } finally {
      await closeWS(wsF);
      await closeWS(wsJ);
      await closeWS(wsK);
    }
  });
});

describe('Game events — planets', () => {
  it('records planet_claimed only when ownership actually changes', async () => {
    const sector = 3;
    const claimant = await createPlayer(`ge_claim_${Date.now()}`, sector);
    const planetId = await insertPlanet(sector, `Claimable_${Date.now()}`);
    const { ws } = await connectPlayer(claimant.token);
    try {
      await wsRequest(ws, { type: Commands.LandOnPlanet.name, planetId }, Commands.LandOnPlanet.reply.name);
      await wsRequest(ws, { type: Commands.ClaimPlanet.name, ownership: 'personal' }, Commands.ClaimPlanet.reply.name);
      await wsRequest(ws, { type: Commands.ClaimPlanet.name, ownership: 'personal' }, Commands.ClaimPlanet.reply.name);

      const events = await eventsOfKind('planet_claimed', (p) => p.planet.planetId === planetId);
      assert.equal(events.length, 1);
      assert.deepEqual(events[0].payload.owner, { kind: 'player', playerId: claimant.id, name: await playerName(claimant.id) });
      assert.equal(events[0].payload.claimedBy.playerId, claimant.id);
      assert.equal(events[0].payload.sectorNumber, sector);
    } finally {
      await closeWS(ws);
    }
  });

  it('records planet_destroyed', async () => {
    const sector = 4;
    const buster = await createPlayer(`ge_buster_${Date.now()}`, sector);
    const planetName = `Doomed_${Date.now()}`;
    const planetId = await insertPlanet(sector, planetName);
    await pool.query(
      `INSERT INTO ship_hardware (ship_id, hardware_item_id, quantity)
       SELECT p.ship_id, hi.id, 1 FROM players p, hardware_item hi
       WHERE p.id = $1 AND hi.name = 'planet_buster'`,
      [buster.id],
    );
    const { ws } = await connectPlayer(buster.token);
    try {
      await wsRequest(ws, { type: Commands.LandOnPlanet.name, planetId }, Commands.LandOnPlanet.reply.name);
      const res = await wsRequest(ws, { type: Commands.DestroyPlanet.name }, Commands.DestroyPlanet.reply.name);
      assert.equal(res.destroyed, true);

      const events = await eventsOfKind('planet_destroyed', (p) => p.planet.planetId === planetId);
      assert.equal(events.length, 1);
      assert.deepEqual(events[0].payload.planet, { planetId, name: planetName });
      assert.equal(events[0].payload.destroyer.playerId, buster.id);
      assert.equal(events[0].payload.sectorNumber, sector);
    } finally {
      await closeWS(ws);
    }
  });

  it('records base_upgraded from both the hourly job and the lazy on-read completion', async () => {
    const { completeDueBaseConstructions, getCurrentPlanetBase } = await import('../dist/services/planet-base-construction.js');
    const sector = 6;
    const owner = await createPlayer(`ge_base_${Date.now()}`, sector);
    const hourlyPlanetId = await insertPlanet(sector, `Bastion_${Date.now()}`, owner.id);
    const lazyPlanetId = await insertPlanet(sector, `LazyBastion_${Date.now()}`, owner.id);
    for (const planetId of [hourlyPlanetId, lazyPlanetId]) {
      await pool.query(
        `INSERT INTO planet_bases (planet_id, universe_id, level, construction_target_level, construction_started_at, construction_completes_at)
         VALUES ($1, ${UNIVERSE_ID}, 0, 1, NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 minute')`,
        [planetId],
      );
    }

    // The scheduled job may already have completed both; each path must record exactly one event per planet.
    await completeDueBaseConstructions();
    const viaLazy = await getCurrentPlanetBase(lazyPlanetId);
    assert.equal(viaLazy.level, 1);

    for (const planetId of [hourlyPlanetId, lazyPlanetId]) {
      const events = await eventsOfKind('base_upgraded', (p) => p.planet.planetId === planetId);
      assert.equal(events.length, 1, `planet ${planetId} should have exactly one base_upgraded event`);
      assert.equal(events[0].payload.level, 1);
      assert.equal(events[0].payload.sectorNumber, sector);
    }
    assert.equal((await getCurrentPlanetBase(hourlyPlanetId)).level, 1);
    assert.equal((await eventsOfKind('base_upgraded', (p) => p.planet.planetId === hourlyPlanetId)).length, 1);
  });
});

describe('Game events — planet collisions', () => {
  it('destroys both planets, mails the owners and records planet_collision', async () => {
    const { resolveDuePlanetCollisions } = await import('../dist/services/planet-collisions.js');
    const sector = 8;
    const owner = await createPlayer(`ge_collide_${Date.now()}`, sector);
    const planetId = await insertPlanet(sector, `Rock_${Date.now()}`, owner.id);
    const otherId = await insertPlanet(sector, `Pebble_${Date.now()}`);
    const futureId = await insertPlanet(sector, `Later_${Date.now()}`);
    await pool.query(
      `INSERT INTO planet_collisions (collision_planet, colliding_with, collision_at)
       VALUES ($1, $2, NOW() - INTERVAL '1 minute'), ($3, $2, NOW() + INTERVAL '1 day')`,
      [planetId, otherId, futureId],
    );

    // Resolution runs in this process (no sockets), so only the mail side of the occupant notice is observable here.
    const occupant = await createPlayer(`ge_occupant_${Date.now()}`, sector);
    await pool.query('UPDATE players SET on_planet_id = $1 WHERE id = $2', [otherId, occupant.id]);
    await resolveDuePlanetCollisions();
    const liftedOff = await pool.query('SELECT on_planet_id FROM players WHERE id = $1', [occupant.id]);
    assert.equal(liftedOff.rows[0].on_planet_id, null);
    const occupantMail = await pool.query(
      `SELECT body FROM messages WHERE recipient_player_id = $1 AND kind = 'planet_destroyed'`,
      [occupant.id],
    );
    assert.equal(occupantMail.rows.length, 1);
    assert.match(occupantMail.rows[0].body, /destroyed in a collision/);

    const remaining = await pool.query('SELECT id FROM planets WHERE id = ANY($1) ORDER BY id', [[planetId, otherId, futureId]]);
    assert.deepEqual(remaining.rows.map((r) => r.id), [futureId]);
    const events = await eventsOfKind('planet_collision', (p) => p.planet.planetId === planetId);
    assert.equal(events.length, 1);
    assert.equal(events[0].payload.collidingWith.planetId, otherId);
    assert.equal(events[0].payload.sectorNumber, sector);
    const mail = await pool.query(
      `SELECT body FROM messages WHERE recipient_player_id = $1 AND kind = 'planet_collision'`,
      [owner.id],
    );
    assert.equal(mail.rows.length, 1);
    assert.match(mail.rows[0].body, /Both planets were destroyed/);
  });
});

describe('Game events — ports', () => {
  it('records port_built when construction completes', async () => {
    const { runAdvancePortConstructions } = await import('../dist/services/port-construction-advance.js');
    const portless = await pool.query(
      `SELECT s.sector_number, s.id FROM sectors s
       LEFT JOIN ports p ON p.sector_id = s.id
       LEFT JOIN port_construction pc ON pc.sector_id = s.id
       WHERE s.universe_id = $1 AND s.sector_number > 1 AND p.id IS NULL AND pc.sector_id IS NULL
       ORDER BY s.sector_number LIMIT 1`,
      [UNIVERSE_ID],
    );
    const sector = portless.rows[0].sector_number;
    const sectorId = portless.rows[0].id;
    const builder = await createPlayer(`ge_port_${Date.now()}`, sector);
    const planetId = await insertPlanet(sector, `Supply_${Date.now()}`, builder.id);
    await pool.query('UPDATE planets SET fuel = 100000, organics = 100000, equipment = 100000 WHERE id = $1', [planetId]);
    const portName = `Port ${Date.now()}`;
    await pool.query(
      `INSERT INTO port_construction (sector_id, builder_player_id, owner_player_id, port_class, port_name,
                                      days_required, days_completed, last_advance_attempt_at)
       VALUES ($1, $2, $2, 1, $3, 1, 0, NOW() - INTERVAL '2 days')`,
      [sectorId, builder.id, portName],
    );

    await runAdvancePortConstructions();

    const port = await pool.query('SELECT id FROM ports WHERE sector_id = $1', [sectorId]);
    assert.equal(port.rows.length, 1);
    const events = await eventsOfKind('port_built', (p) => p.portId === port.rows[0].id);
    assert.equal(events.length, 1);
    assert.equal(events[0].payload.portName, portName);
    assert.equal(events[0].payload.sectorNumber, sector);
    assert.deepEqual(events[0].payload.owner, { kind: 'player', playerId: builder.id, name: await playerName(builder.id) });
  });
});

describe('Game events — Galactic News reading', () => {
  it('reports the earliest date and returns events since a timestamp, newest last', async () => {
    const reader = await createPlayer(`ge_reader_${Date.now()}`);
    const { ws } = await connectPlayer(reader.token);
    try {
      const range = await wsRequest(ws, { type: Commands.GalacticNewsRange.name }, Commands.GalacticNewsRange.reply.name);
      const earliest = await pool.query(
        `SELECT created_at FROM game_events WHERE universe_id = $1 AND visibility = 'galactic' ORDER BY id LIMIT 1`,
        [UNIVERSE_ID],
      );
      assert.equal(range.earliestCreatedAt, earliest.rows[0].created_at.toISOString());

      const clanName = `News Clan ${Date.now()}`;
      await wsRequest(ws, { type: Commands.ClanCreate.name, name: clanName, password: 'secret' }, Commands.ClanCreate.reply.name);
      const created = await pool.query(
        `SELECT id, created_at FROM game_events WHERE universe_id = $1 AND kind = 'clan_created'
         AND payload->'clan'->>'name' = $2`,
        [UNIVERSE_ID, clanName],
      );
      const createdId = Number(created.rows[0].id);
      const since = new Date(created.rows[0].created_at.getTime() - 1000).toISOString();
      const news = await wsRequest(ws, { type: Commands.ReadGalacticNews.name, since }, Commands.ReadGalacticNews.reply.name);
      const ids = news.entries.map((e) => e.id);
      assert.ok(ids.includes(createdId));
      assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
      const mine = news.entries.find((e) => e.id === createdId);
      assert.equal(mine.event.kind, 'clan_created');
      assert.equal(mine.event.founder.name, await playerName(reader.id));
      assert.ok(news.entries.every((e) => e.createdAt >= since));

      const sinceChunks = new Date().toISOString();
      const chunkPayload = JSON.stringify({ player: { playerId: reader.id, name: 'Chunky' } });
      await pool.query(
        `INSERT INTO game_events (universe_id, kind, visibility, payload)
         SELECT $1, 'player_joined_universe', 'galactic', $2::jsonb FROM generate_series(1, 205)`,
        [UNIVERSE_ID, chunkPayload],
      );
      const first = await wsRequest(ws, { type: Commands.ReadGalacticNews.name, since: sinceChunks }, Commands.ReadGalacticNews.reply.name);
      assert.equal(first.hasMore, true);
      assert.equal(first.entries.length, 200);
      const lastId = first.entries[first.entries.length - 1].id;
      const second = await wsRequest(ws, { type: Commands.ReadGalacticNews.name, since: sinceChunks, afterId: lastId }, Commands.ReadGalacticNews.reply.name);
      assert.equal(second.hasMore, false);
      assert.equal(second.entries.length, 5);
      assert.ok(second.entries.every((e) => e.id > lastId));

      const future = new Date(Date.now() + 60_000).toISOString();
      const none = await wsRequest(ws, { type: Commands.ReadGalacticNews.name, since: future }, Commands.ReadGalacticNews.reply.name);
      assert.deepEqual(none.entries, []);
    } finally {
      await closeWS(ws);
    }
  });
});

async function playerName(playerId) {
  const res = await pool.query('SELECT name FROM players WHERE id = $1', [playerId]);
  return res.rows[0].name;
}

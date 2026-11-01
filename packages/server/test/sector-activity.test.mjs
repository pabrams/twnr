import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestUser,
  createTestPlayer,
  connectWS,
  closeWS,
  wsRequest,
  waitForMsg,
  expectNoMsg,
} from './helpers.mjs';
import { ensureServer, createPool } from './global-setup.mjs';
import { Commands, Events } from '@twnr/shared';

const UNIVERSE_ID = 1;

let pool;

async function createPlayer(name, sector = 1) {
  const { userId, token } = await createTestUser(pool);
  const playerId = await createTestPlayer(pool, userId, UNIVERSE_ID, name, sector);
  return { id: playerId, token };
}

before(async () => {
  await ensureServer();
  pool = createPool();
});

after(async () => {
  if (pool) await pool.end();
});

describe('Sector activity notifications', () => {
  it('notifies sector observers of dock, undock, land and liftoff', async () => {
    const actor = await createPlayer(`act_sa_${Date.now()}`, 1);
    const observer = await createPlayer(`obs_sa_${Date.now()}`, 1);
    const { ws: wsA, ready: readyA } = await connectWS({ token: actor.token, universeId: UNIVERSE_ID });
    const { ws: wsO, ready: readyO } = await connectWS({ token: observer.token, universeId: UNIVERSE_ID });
    await readyA;
    await readyO;
    try {
      // Dock at the sector-1 port.
      let evt = waitForMsg(wsO, Events.SectorActivity.name);
      await wsRequest(wsA, { type: Commands.Dock.name }, Commands.Dock.reply.name);
      let msg = await evt;
      assert.equal(msg.activity, 'dock');
      assert.equal(msg.playerId, actor.id);
      assert.equal(typeof msg.playerName, 'string');

      // Undock: event carries both the port name and the ship name.
      evt = waitForMsg(wsO, Events.SectorActivity.name);
      await wsRequest(wsA, { type: Commands.Undock.name }, Commands.Undock.reply.name);
      msg = await evt;
      assert.equal(msg.activity, 'undock');
      assert.equal(msg.playerId, actor.id);
      assert.ok(msg.targetName, 'undock event should include the port name');
      assert.ok(msg.shipName, 'undock event should include the ship name');

      // Land on Earth (sector 1 auto-lands via SectorPlanets).
      evt = waitForMsg(wsO, Events.SectorActivity.name);
      const landed = await wsRequest(wsA, { type: Commands.SectorPlanets.name }, Commands.SectorPlanets.reply.name);
      assert.equal(landed.outcome, 'landed');
      msg = await evt;
      assert.equal(msg.activity, 'land');
      assert.equal(msg.playerId, actor.id);
      assert.ok(msg.targetName);

      // Lift off.
      evt = waitForMsg(wsO, Events.SectorActivity.name);
      await wsRequest(wsA, { type: Commands.LeavePlanet.name }, Commands.LeavePlanet.reply.name);
      msg = await evt;
      assert.equal(msg.activity, 'liftoff');
      assert.equal(msg.playerId, actor.id);
      assert.ok(msg.targetName);
    } finally {
      await closeWS(wsA);
      await closeWS(wsO);
    }
  });

  it('requires undocking before warping out of the sector', async () => {
    const actor = await createPlayer(`act_sa3_${Date.now()}`, 1);
    const { ws, ready } = await connectWS({ token: actor.token, universeId: UNIVERSE_ID });
    await ready;
    try {
      await wsRequest(ws, { type: Commands.Dock.name }, Commands.Dock.reply.name);
      const warps = await wsRequest(ws, { type: Commands.WarpsOut.name, id: 1 }, Commands.WarpsOut.reply.name);
      const target = warps.warps[0].sector;
      const res = await wsRequest(ws, { type: Commands.Move.name, sector: target }, Commands.Move.reply.name);
      assert.equal(res.outcome, 'refused');
      assert.equal(res.reason, 'docked');
      // After undocking the same warp succeeds.
      await wsRequest(ws, { type: Commands.Undock.name }, Commands.Undock.reply.name);
      const res2 = await wsRequest(ws, { type: Commands.Move.name, sector: target }, Commands.Move.reply.name);
      assert.notEqual(res2.outcome, 'refused');
    } finally {
      await closeWS(ws);
    }
  });

  it('requires docking before trading at a port', async () => {
    const actor = await createPlayer(`act_sa4_${Date.now()}`, 1);
    const { ws, ready } = await connectWS({ token: actor.token, universeId: UNIVERSE_ID });
    await ready;
    try {
      const res = await wsRequest(
        ws,
        { type: Commands.PortTransaction.name, good: 'fuel', quantity: 1, action: 'buy' },
        Commands.PortTransaction.reply.name,
      );
      assert.equal(res.outcome, 'refused');
      assert.equal(res.reason, 'notDocked');
    } finally {
      await closeWS(ws);
    }
  });

  it('hides starbase-docked traders and notifies on starbase dock/undock', async () => {
    const sbRow = await pool.query(
      `SELECT s.sector_number FROM ports p JOIN sectors s ON p.sector_id = s.id
       WHERE p.class = 9 AND s.universe_id = $1 LIMIT 1`,
      [UNIVERSE_ID],
    );
    const sbSector = sbRow.rows[0].sector_number;
    const actor = await createPlayer(`act_sa5_${Date.now()}`, sbSector);
    const observer = await createPlayer(`obs_sa5_${Date.now()}`, sbSector);
    const { ws: wsA, ready: readyA } = await connectWS({ token: actor.token, universeId: UNIVERSE_ID });
    const { ws: wsO, ready: readyO } = await connectWS({ token: observer.token, universeId: UNIVERSE_ID });
    await readyA;
    await readyO;
    try {
      let evt = waitForMsg(wsO, Events.SectorActivity.name);
      await wsRequest(wsA, { type: Commands.DockStarbase.name }, Commands.DockStarbase.reply.name);
      let msg = await evt;
      assert.equal(msg.activity, 'dock');
      assert.equal(msg.playerId, actor.id);

      // Docked-at-starbase trader is hidden from the sector display.
      const disp = await wsRequest(wsO, { type: Commands.SectorDisplay.name }, Commands.SectorDisplay.reply.name);
      assert.ok(!disp.players.some((p) => p.id === actor.id), 'starbase-docked trader should be hidden');

      evt = waitForMsg(wsO, Events.SectorActivity.name);
      await wsRequest(wsA, { type: Commands.LeaveStarbase.name }, Commands.LeaveStarbase.reply.name);
      msg = await evt;
      assert.equal(msg.activity, 'undock');
      assert.equal(msg.playerId, actor.id);
      assert.ok(msg.shipName, 'starbase undock event should include the ship name');
    } finally {
      await closeWS(wsA);
      await closeWS(wsO);
    }
  });

  it('does not notify docked traders or traders on planets', async () => {
    const actor = await createPlayer(`act_sa6_${Date.now()}`, 1);
    const dockedObs = await createPlayer(`obs_sa6d_${Date.now()}`, 1);
    const planetObs = await createPlayer(`obs_sa6p_${Date.now()}`, 1);
    const { ws: wsA, ready: rA } = await connectWS({ token: actor.token, universeId: UNIVERSE_ID });
    const { ws: wsD, ready: rD } = await connectWS({ token: dockedObs.token, universeId: UNIVERSE_ID });
    const { ws: wsP, ready: rP } = await connectWS({ token: planetObs.token, universeId: UNIVERSE_ID });
    await rA; await rD; await rP;
    try {
      await wsRequest(wsD, { type: Commands.Dock.name }, Commands.Dock.reply.name);
      await wsRequest(wsP, { type: Commands.SectorPlanets.name }, Commands.SectorPlanets.reply.name);

      const silentD = expectNoMsg(wsD, Events.SectorActivity.name, 600);
      const silentP = expectNoMsg(wsP, Events.SectorActivity.name, 600);
      await wsRequest(wsA, { type: Commands.Dock.name }, Commands.Dock.reply.name);
      await Promise.all([silentD, silentP]);
    } finally {
      await closeWS(wsA);
      await closeWS(wsD);
      await closeWS(wsP);
    }
  });

  it('clears on_planet_id for everyone when a planet is destroyed', async () => {
    const sector = 5;
    const sectorRow = await pool.query(
      'SELECT id FROM sectors WHERE sector_number = $1 AND universe_id = $2',
      [sector, UNIVERSE_ID],
    );
    const planetRow = await pool.query(
      `INSERT INTO planets (sector_id, universe_id, universe_planet_number, name)
       VALUES ($1, $2, (SELECT COALESCE(MAX(universe_planet_number), 0) + 1 FROM planets WHERE universe_id = $2), $3)
       RETURNING id`,
      [sectorRow.rows[0].id, UNIVERSE_ID, `Doomed_${Date.now()}`],
    );
    const planetId = planetRow.rows[0].id;

    const buster = await createPlayer(`act_sa7_${Date.now()}`, sector);
    const bystander = await createPlayer(`obs_sa7_${Date.now()}`, sector);
    const watcher = await createPlayer(`wat_sa7_${Date.now()}`, sector);
    // Give the destroyer a planet buster.
    await pool.query(
      `INSERT INTO ship_hardware (ship_id, hardware_item_id, quantity)
       SELECT p.ship_id, hi.id, 1 FROM players p, hardware_item hi
       WHERE p.id = $1 AND hi.name = 'planet_buster'`,
      [buster.id],
    );

    const { ws: wsB, ready: rB } = await connectWS({ token: buster.token, universeId: UNIVERSE_ID });
    const { ws: wsO, ready: rO } = await connectWS({ token: bystander.token, universeId: UNIVERSE_ID });
    const { ws: wsW, ready: rW } = await connectWS({ token: watcher.token, universeId: UNIVERSE_ID });
    await rB; await rO; await rW;
    try {
      // Both land on the doomed planet.
      await wsRequest(wsB, { type: Commands.LandOnPlanet.name, planetId }, Commands.LandOnPlanet.reply.name);
      await wsRequest(wsO, { type: Commands.LandOnPlanet.name, planetId }, Commands.LandOnPlanet.reply.name);

      const occupantAlert = waitForMsg(wsO, Events.PlanetDestroyed.name);
      const watcherAlert = waitForMsg(wsW, Events.PlanetDestroyed.name);
      const res = await wsRequest(wsB, { type: Commands.DestroyPlanet.name }, Commands.DestroyPlanet.reply.name);
      assert.equal(res.destroyed, true);

      // The bystander on the surface is told they were lifted off; the watcher in space just sees it happen.
      const lifted = await occupantAlert;
      assert.equal(lifted.wasOnPlanet, true);
      assert.equal(lifted.cause, 'buster');
      assert.equal((await watcherAlert).wasOnPlanet, false);
      const occupantMail = await pool.query(
        `SELECT body FROM messages WHERE recipient_player_id = $1 AND kind = 'planet_destroyed'`,
        [bystander.id],
      );
      assert.equal(occupantMail.rows.length, 1);
      assert.match(occupantMail.rows[0].body, /while you were on the surface/);

      // DB cleared for everyone who was on the planet.
      const rows = await pool.query(
        'SELECT id, on_planet_id FROM players WHERE id = ANY($1)',
        [[buster.id, bystander.id]],
      );
      for (const r of rows.rows) {
        assert.equal(r.on_planet_id, null, `player ${r.id} should be off the destroyed planet`);
      }

      // In-memory state cleared too: the bystander observes sector activity again.
      const evt = waitForMsg(wsO, Events.SectorActivity.name);
      await wsRequest(wsW, { type: Commands.SectorPlanets.name }, Commands.SectorPlanets.reply.name);
      // (no planets left in sector 5 for the watcher to land on; dock instead is not
      // possible here, so have the watcher land/liftoff via a fresh planet)
      const planet2 = await pool.query(
        `INSERT INTO planets (sector_id, universe_id, universe_planet_number, name)
         VALUES ($1, $2, (SELECT COALESCE(MAX(universe_planet_number), 0) + 1 FROM planets WHERE universe_id = $2), $3)
         RETURNING id`,
        [sectorRow.rows[0].id, UNIVERSE_ID, `Fresh_${Date.now()}`],
      );
      await wsRequest(wsW, { type: Commands.LandOnPlanet.name, planetId: planet2.rows[0].id }, Commands.LandOnPlanet.reply.name);
      const msg = await evt;
      assert.equal(msg.activity, 'land');
      assert.equal(msg.playerId, watcher.id);
    } finally {
      await closeWS(wsB);
      await closeWS(wsO);
      await closeWS(wsW);
    }
  });

  it('does not notify players in other sectors', async () => {
    const actor = await createPlayer(`act_sa2_${Date.now()}`, 1);
    const farObserver = await createPlayer(`obs_sa2_${Date.now()}`, 3);
    const { ws: wsA, ready: readyA } = await connectWS({ token: actor.token, universeId: UNIVERSE_ID });
    const { ws: wsO, ready: readyO } = await connectWS({ token: farObserver.token, universeId: UNIVERSE_ID });
    await readyA;
    await readyO;
    try {
      const silent = expectNoMsg(wsO, Events.SectorActivity.name, 600);
      await wsRequest(wsA, { type: Commands.Dock.name }, Commands.Dock.reply.name);
      await silent;
    } finally {
      await closeWS(wsA);
      await closeWS(wsO);
    }
  });
});

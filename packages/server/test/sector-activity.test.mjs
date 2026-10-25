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
import { ClientTag, ServerTag } from '@twnr/shared';

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
      let evt = waitForMsg(wsO, ServerTag.SectorActivity);
      await wsRequest(wsA, { type: ClientTag.Dock }, ServerTag.DockResult);
      let msg = await evt;
      assert.equal(msg.activity, 'dock');
      assert.equal(msg.playerId, actor.id);
      assert.equal(typeof msg.playerName, 'string');

      // Undock: event carries both the port name and the ship name.
      evt = waitForMsg(wsO, ServerTag.SectorActivity);
      await wsRequest(wsA, { type: ClientTag.Undock }, ServerTag.UndockResult);
      msg = await evt;
      assert.equal(msg.activity, 'undock');
      assert.equal(msg.playerId, actor.id);
      assert.ok(msg.targetName, 'undock event should include the port name');
      assert.ok(msg.shipName, 'undock event should include the ship name');

      // Land on Earth (sector 1 auto-lands via GetSectorPlanets).
      evt = waitForMsg(wsO, ServerTag.SectorActivity);
      await wsRequest(wsA, { type: ClientTag.GetSectorPlanets }, ServerTag.LandOnPlanetResult);
      msg = await evt;
      assert.equal(msg.activity, 'land');
      assert.equal(msg.playerId, actor.id);
      assert.ok(msg.targetName);

      // Lift off.
      evt = waitForMsg(wsO, ServerTag.SectorActivity);
      await wsRequest(wsA, { type: ClientTag.LeavePlanet }, ServerTag.LeavePlanetResult);
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
      await wsRequest(ws, { type: ClientTag.Dock }, ServerTag.DockResult);
      const warps = await wsRequest(ws, { type: ClientTag.WarpsOut, id: 1 }, ServerTag.WarpsOutResult);
      const target = warps.warps[0].sector;
      const res = await wsRequest(ws, { type: ClientTag.Move, sector: target }, ServerTag.MoveResult);
      assert.equal(res.outcome, 'error');
      assert.match(res.message, /undock/i);
      // After undocking the same warp succeeds.
      await wsRequest(ws, { type: ClientTag.Undock }, ServerTag.UndockResult);
      const res2 = await wsRequest(ws, { type: ClientTag.Move, sector: target }, ServerTag.MoveResult);
      assert.notEqual(res2.outcome, 'error');
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
        { type: ClientTag.PortTransaction, good: 'fuel', quantity: 1, action: 'buy' },
        ServerTag.PortTransactionResult,
      );
      assert.equal(res.type, ServerTag.Error);
      assert.match(res.message, /dock/i);
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
      let evt = waitForMsg(wsO, ServerTag.SectorActivity);
      await wsRequest(wsA, { type: ClientTag.DockStarbase }, ServerTag.DockStarbaseResult);
      let msg = await evt;
      assert.equal(msg.activity, 'dock');
      assert.equal(msg.playerId, actor.id);

      // Docked-at-starbase trader is hidden from the sector display.
      const disp = await wsRequest(wsO, { type: ClientTag.SectorDisplay }, ServerTag.SectorDisplayResult);
      assert.ok(!disp.players.some((p) => p.id === actor.id), 'starbase-docked trader should be hidden');

      evt = waitForMsg(wsO, ServerTag.SectorActivity);
      await wsRequest(wsA, { type: ClientTag.LeaveStarbase }, ServerTag.LeaveStarbaseResult);
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
      await wsRequest(wsD, { type: ClientTag.Dock }, ServerTag.DockResult);
      await wsRequest(wsP, { type: ClientTag.GetSectorPlanets }, ServerTag.LandOnPlanetResult);

      const silentD = expectNoMsg(wsD, ServerTag.SectorActivity, 600);
      const silentP = expectNoMsg(wsP, ServerTag.SectorActivity, 600);
      await wsRequest(wsA, { type: ClientTag.Dock }, ServerTag.DockResult);
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
      await wsRequest(wsB, { type: ClientTag.LandOnPlanet, planetId }, ServerTag.LandOnPlanetResult);
      await wsRequest(wsO, { type: ClientTag.LandOnPlanet, planetId }, ServerTag.LandOnPlanetResult);

      const res = await wsRequest(wsB, { type: ClientTag.DestroyPlanet }, ServerTag.DestroyPlanetResult);
      assert.equal(res.destroyed, true);

      // DB cleared for everyone who was on the planet.
      const rows = await pool.query(
        'SELECT id, on_planet_id FROM players WHERE id = ANY($1)',
        [[buster.id, bystander.id]],
      );
      for (const r of rows.rows) {
        assert.equal(r.on_planet_id, null, `player ${r.id} should be off the destroyed planet`);
      }

      // In-memory state cleared too: the bystander observes sector activity again.
      const evt = waitForMsg(wsO, ServerTag.SectorActivity);
      await wsRequest(wsW, { type: ClientTag.GetSectorPlanets }, ServerTag.GetSectorPlanetsResult);
      // (no planets left in sector 5 for the watcher to land on; dock instead is not
      // possible here, so have the watcher land/liftoff via a fresh planet)
      const planet2 = await pool.query(
        `INSERT INTO planets (sector_id, universe_id, universe_planet_number, name)
         VALUES ($1, $2, (SELECT COALESCE(MAX(universe_planet_number), 0) + 1 FROM planets WHERE universe_id = $2), $3)
         RETURNING id`,
        [sectorRow.rows[0].id, UNIVERSE_ID, `Fresh_${Date.now()}`],
      );
      await wsRequest(wsW, { type: ClientTag.LandOnPlanet, planetId: planet2.rows[0].id }, ServerTag.LandOnPlanetResult);
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
      const silent = expectNoMsg(wsO, ServerTag.SectorActivity, 600);
      await wsRequest(wsA, { type: ClientTag.Dock }, ServerTag.DockResult);
      await silent;
    } finally {
      await closeWS(wsA);
      await closeWS(wsO);
    }
  });
});

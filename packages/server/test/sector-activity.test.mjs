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

      // Undock.
      evt = waitForMsg(wsO, ServerTag.SectorActivity);
      await wsRequest(wsA, { type: ClientTag.Undock }, ServerTag.UndockResult);
      msg = await evt;
      assert.equal(msg.activity, 'undock');
      assert.equal(msg.playerId, actor.id);

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

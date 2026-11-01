import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestUser, createTestPlayer, connectWS, closeWS, wsRequest } from './helpers.mjs';
import { ensureServer, createPool } from './global-setup.mjs';
import { Commands, Events } from '@twnr/shared';

const UNIVERSE_ID = 1;

let pool;

before(async () => {
  await ensureServer();
  pool = createPool();
});

after(async () => {
  if (pool) await pool.end();
});

async function createPlayer(name, sector, drones = 10) {
  const { userId, token } = await createTestUser(pool);
  const id = await createTestPlayer(pool, userId, UNIVERSE_ID, name, sector, drones, 0);
  return { id, token };
}

async function sectorDbId(sectorNumber) {
  const res = await pool.query('SELECT id FROM sectors WHERE sector_number = $1 AND universe_id = $2', [sectorNumber, UNIVERSE_ID]);
  return res.rows[0].id;
}

async function placeDrones(sectorNumber, owner, quantity) {
  await pool.query(
    `INSERT INTO sector_drones (sector_id, owner_player_id, owner_clan_id, quantity) VALUES ($1, $2, $3, $4)
     ON CONFLICT (sector_id) DO UPDATE SET owner_player_id = $2, owner_clan_id = $3, quantity = $4`,
    [await sectorDbId(sectorNumber), owner.playerId ?? null, owner.clanId ?? null, quantity],
  );
}

async function clearDrones(sectorNumber) {
  await pool.query('DELETE FROM sector_drones WHERE sector_id = $1', [await sectorDbId(sectorNumber)]);
}

/** A warp out of sector 1 that currently has no drones, so tests can stage their own. */
async function emptyNeighbourOf(ws) {
  const warps = await wsRequest(ws, { type: Commands.WarpsOut.name, id: 1 }, Commands.WarpsOut.reply.name);
  for (const w of warps.warps) {
    const drones = await pool.query('SELECT 1 FROM sector_drones WHERE sector_id = $1', [await sectorDbId(w.sector)]);
    if (drones.rows.length === 0) return w.sector;
  }
  throw new Error('no drone-free neighbour of sector 1');
}

describe('Drone encounters', () => {
  it('does not trap a player when hostile drones are deployed around them', async () => {
    const sector = 9;
    const bystander = await createPlayer(`enc_bystander_${Date.now()}`, sector);
    const enemy = await createPlayer(`enc_enemy_${Date.now()}`, sector);
    const { ws, ready } = await connectWS({ token: bystander.token, universeId: UNIVERSE_ID });
    await ready;
    try {
      await placeDrones(sector, { playerId: enemy.id }, 5);
      const shipInfo = await wsRequest(ws, { type: Commands.ShipInfo.name }, Commands.ShipInfo.reply.name);
      assert.equal(shipInfo.type, Commands.ShipInfo.reply.name, 'player who was already here must not be stuck');
      const warps = await wsRequest(ws, { type: Commands.WarpsOut.name, id: sector }, Commands.WarpsOut.reply.name);
      const moved = await wsRequest(ws, { type: Commands.Move.name, sector: warps.warps[0].sector }, Commands.Move.reply.name);
      assert.notEqual(moved.outcome, 'refused');
    } finally {
      await clearDrones(sector);
      await closeWS(ws);
    }
  });

  it('enters an encounter on warping into hostile drones and leaves it on victory', async () => {
    const attacker = await createPlayer(`enc_attacker_${Date.now()}`, 1, 10);
    const enemy = await createPlayer(`enc_owner_${Date.now()}`, 1);
    const { ws, ready } = await connectWS({ token: attacker.token, universeId: UNIVERSE_ID });
    await ready;
    let target;
    try {
      target = await emptyNeighbourOf(ws);
      await placeDrones(target, { playerId: enemy.id }, 3);

      const moved = await wsRequest(ws, { type: Commands.Move.name, sector: target }, Commands.Move.reply.name);
      assert.equal(moved.outcome, 'encounter');

      const blocked = await wsRequest(ws, { type: Commands.DeployDronesInfo.name }, Commands.DeployDronesInfo.reply.name);
      assert.equal(blocked.outcome, 'refused');
      assert.equal(blocked.reason, 'inEncounter');

      const fought = await wsRequest(ws, { type: Commands.AttackSectorDrones.name, drones: 5 }, Commands.AttackSectorDrones.reply.name);
      assert.equal(fought.victory, true);

      const freed = await wsRequest(ws, { type: Commands.DeployDronesInfo.name }, Commands.DeployDronesInfo.reply.name);
      assert.equal(freed.outcome, 'ok');
    } finally {
      if (target) await clearDrones(target);
      await closeWS(ws);
    }
  });

  it('treats clan-owned drones as friendly when warping in', async () => {
    const stamp = Date.now();
    const member = await createPlayer(`enc_member_${stamp}`, 1);
    const clan = await pool.query(
      `INSERT INTO clans (universe_id, universe_clan_number, name, password_hash, leader_id)
       VALUES ($1, (SELECT COALESCE(MAX(universe_clan_number), 0) + 1 FROM clans WHERE universe_id = $1), $2, 'hash', $3)
       RETURNING id`,
      [UNIVERSE_ID, `Encounter Clan ${stamp}`, member.id],
    );
    await pool.query('UPDATE players SET clan_id = $1 WHERE id = $2', [clan.rows[0].id, member.id]);
    const { ws, ready } = await connectWS({ token: member.token, universeId: UNIVERSE_ID });
    await ready;
    let target;
    try {
      target = await emptyNeighbourOf(ws);
      await placeDrones(target, { clanId: clan.rows[0].id }, 3);
      const moved = await wsRequest(ws, { type: Commands.Move.name, sector: target }, Commands.Move.reply.name);
      assert.equal(moved.outcome, 'success');
    } finally {
      if (target) await clearDrones(target);
      await closeWS(ws);
    }
  });

  it('ends the encounter as a victory if the drones vanish before the attack', async () => {
    const attacker = await createPlayer(`enc_vanish_${Date.now()}`, 1, 10);
    const enemy = await createPlayer(`enc_vanish_owner_${Date.now()}`, 1);
    const { ws, ready } = await connectWS({ token: attacker.token, universeId: UNIVERSE_ID });
    await ready;
    let target;
    try {
      target = await emptyNeighbourOf(ws);
      await placeDrones(target, { playerId: enemy.id }, 3);
      const moved = await wsRequest(ws, { type: Commands.Move.name, sector: target }, Commands.Move.reply.name);
      assert.equal(moved.outcome, 'encounter');

      await clearDrones(target);
      const fought = await wsRequest(ws, { type: Commands.AttackSectorDrones.name, drones: 1 }, Commands.AttackSectorDrones.reply.name);
      assert.equal(fought.victory, true);
      assert.equal(fought.dronesLost, 0);

      const freed = await wsRequest(ws, { type: Commands.DeployDronesInfo.name }, Commands.DeployDronesInfo.reply.name);
      assert.equal(freed.outcome, 'ok');
    } finally {
      if (target) await clearDrones(target);
      await closeWS(ws);
    }
  });
});

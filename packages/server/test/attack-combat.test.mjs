import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestUser, createTestPlayer, connectWS, closeWS, wsRequest, waitForMsg, expectNoMsg } from './helpers.mjs';
import { ensureServer, createPool } from './global-setup.mjs';
import { Commands, Events } from '@twnr/shared';

const UNIVERSE_ID = 1;

let pool;

async function createPlayer(name, sector = 1, drones = 0, shields = 0) {
  const { userId, token } = await createTestUser(pool);
  const playerId = await createTestPlayer(pool, userId, UNIVERSE_ID, name, sector, drones, shields);
  return { id: playerId, token };
}

async function connectPlayer(token) {
  return connectWS({ token, universeId: UNIVERSE_ID });
}

before(async () => {
  await ensureServer();
  pool = createPool();
});

after(async () => {
  if (pool) await pool.end();
});

describe('Combat resolution', () => {
  it('shields absorb first at 1:1 (attacker drones consumed by shields)', async () => {
    const atk = await createPlayer('atk_sh1', 1, 10, 0);
    const def = await createPlayer('def_sh1', 1, 0, 5);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    try {
      const res = await wsRequest(ws1, { type: Commands.AttackShip.name, targetPlayerId: def.id, drones: 3 }, Commands.AttackShip.reply.name);
      assert.equal(res.type, Commands.AttackShip.reply.name);

      const atkShip = await pool.query('SELECT drones FROM ships WHERE id = (SELECT ship_id FROM players WHERE id = $1)', [atk.id]);
      assert.equal(atkShip.rows[0].drones, 7, 'Attacker should have 7 drones remaining');
      const defShip = await pool.query('SELECT shields, drones FROM ships WHERE id = (SELECT ship_id FROM players WHERE id = $1)', [def.id]);
      assert.equal(defShip.rows[0].shields, 2, 'Defender should have 2 shields remaining');
      assert.equal(defShip.rows[0].drones, 0, 'Defender drones should be unchanged at 0');
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
    }
  });

  it('drones engage after shields at 1:1 (mutual destruction)', async () => {
    const atk = await createPlayer('atk_mix', 1, 10, 0);
    const def = await createPlayer('def_mix', 1, 3, 2);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    try {
      const res = await wsRequest(ws1, { type: Commands.AttackShip.name, targetPlayerId: def.id, drones: 4 }, Commands.AttackShip.reply.name);
      assert.equal(res.type, Commands.AttackShip.reply.name);

      const atkShip = await pool.query('SELECT drones FROM ships WHERE id = (SELECT ship_id FROM players WHERE id = $1)', [atk.id]);
      assert.equal(atkShip.rows[0].drones, 6, 'Attacker should have 6 drones remaining');
      const defShip = await pool.query('SELECT drones, shields FROM ships WHERE id = (SELECT ship_id FROM players WHERE id = $1)', [def.id]);
      assert.equal(defShip.rows[0].drones, 1, 'Defender should have 1 drone remaining');
      assert.equal(defShip.rows[0].shields, 0, 'Defender should have 0 shields remaining');
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
    }
  });

  it('exact tie: attacker runs out at same time as defender defenses', async () => {
    const atk = await createPlayer('atk_tie', 1, 10, 0);
    const def = await createPlayer('def_tie', 1, 2, 3);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    try {
      const res = await wsRequest(ws1, { type: Commands.AttackShip.name, targetPlayerId: def.id, drones: 5 }, Commands.AttackShip.reply.name);
      assert.equal(res.type, Commands.AttackShip.reply.name);

      const atkShip = await pool.query('SELECT drones FROM ships WHERE id = (SELECT ship_id FROM players WHERE id = $1)', [atk.id]);
      assert.equal(atkShip.rows[0].drones, 5, 'Attacker should have 5 drones remaining');
      const defShip = await pool.query('SELECT drones, shields FROM ships WHERE id = (SELECT ship_id FROM players WHERE id = $1)', [def.id]);
      assert.equal(defShip.rows.length, 1, 'Defender ship should still exist (exact tie, no remaining attackers)');
      assert.equal(defShip.rows[0].drones, 0, 'Defender should have 0 drones');
      assert.equal(defShip.rows[0].shields, 0, 'Defender should have 0 shields');
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
    }
  });
});

describe('Attack flow', () => {
  it('lists targets with their ship and drones, without announcing anything', async () => {
    const atk = await createPlayer('atk_roster', 1, 10, 0);
    const def = await createPlayer('def_roster', 1, 4, 2);
    const observer = await createPlayer('obs_roster', 1, 0, 0);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    const { ws: ws3, ready } = await connectPlayer(observer.token);
    await ready;
    try {
      const quiet = expectNoMsg(ws3, Events.WeaponsPoweringUp.name, 500);
      const roster = await wsRequest(ws1, { type: Commands.AttackTargets.name }, Commands.AttackTargets.reply.name);
      assert.equal(roster.outcome, 'ok');
      assert.equal(roster.shipDrones, 10);
      const entry = roster.players.find((p) => p.id === def.id);
      assert.equal(entry.name, 'def_roster');
      assert.equal(entry.drones, 4);
      assert.equal(typeof entry.shipTypeName, 'string');
      assert.ok(!('shields' in entry), 'shield strength must not be revealed');
      await quiet;
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
      await closeWS(ws3);
    }
  });

  it('tells everyone but the attacker that weapons are powering up', async () => {
    const atk = await createPlayer('atk_power', 1, 10, 0);
    const def = await createPlayer('def_power', 1, 4, 0);
    const observer = await createPlayer('obs_power', 1, 0, 0);
    const { ws: ws1, ready: ready1 } = await connectPlayer(atk.token);
    const { ws: ws2, ready: ready2 } = await connectPlayer(def.token);
    const { ws: ws3, ready: ready3 } = await connectPlayer(observer.token);
    await Promise.all([ready1, ready2, ready3]);
    try {
      const atDefender = waitForMsg(ws2, Events.WeaponsPoweringUp.name);
      const atObserver = waitForMsg(ws3, Events.WeaponsPoweringUp.name);
      const quietAttacker = expectNoMsg(ws1, Events.WeaponsPoweringUp.name, 500);
      const res = await wsRequest(ws1, { type: Commands.PowerUpWeapons.name, targetPlayerId: def.id }, Commands.PowerUpWeapons.reply.name);
      assert.equal(res.outcome, 'ok');
      assert.equal(res.maxWaveDrones, 10);
      assert.equal((await atDefender).attackerName, 'atk_power');
      assert.equal((await atObserver).attackerName, 'atk_power');
      await quietAttacker;
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
      await closeWS(ws3);
    }
  });

  it('refuses to power up against a player who is not in the sector', async () => {
    const atk = await createPlayer('atk_power_far', 1, 10, 0);
    const def = await createPlayer('def_power_far', 2, 4, 0);
    const { ws: ws1 } = await connectPlayer(atk.token);
    try {
      const res = await wsRequest(ws1, { type: Commands.PowerUpWeapons.name, targetPlayerId: def.id }, Commands.PowerUpWeapons.reply.name);
      assert.equal(res.outcome, 'refused');
      assert.equal(res.reason, 'targetNotHere');
    } finally {
      await closeWS(ws1);
    }
  });

  it('reports drones on both sides and announces the wave to bystanders only', async () => {
    const atk = await createPlayer('atk_wave', 1, 10, 0);
    const def = await createPlayer('def_wave', 1, 3, 2);
    const observer = await createPlayer('obs_wave', 1, 0, 0);
    const { ws: ws1, ready: ready1 } = await connectPlayer(atk.token);
    const { ws: ws2, ready: ready2 } = await connectPlayer(def.token);
    const { ws: ws3, ready: ready3 } = await connectPlayer(observer.token);
    await Promise.all([ready1, ready2, ready3]);
    try {
      const atObserver = waitForMsg(ws3, Events.DroneWaveLaunched.name);
      const quietAttacker = expectNoMsg(ws1, Events.DroneWaveLaunched.name, 500);
      const quietDefender = expectNoMsg(ws2, Events.DroneWaveLaunched.name, 500);
      const res = await wsRequest(ws1, { type: Commands.AttackShip.name, targetPlayerId: def.id, drones: 4 }, Commands.AttackShip.reply.name);
      assert.equal(res.outcome, 'ok');
      assert.equal(res.destroyed, false);
      assert.equal(res.attackerDronesLost, 4);
      assert.equal(res.attackerDronesRemaining, 6);
      assert.equal(res.defenderDronesLost, 2);
      assert.equal(res.defenderDronesRemaining, 1);
      assert.ok(!('defenderShieldsLost' in res), 'shield damage must not be revealed to the attacker');

      const wave = await atObserver;
      assert.equal(wave.attackerName, 'atk_wave');
      assert.equal(wave.defenderName, 'def_wave');
      await quietAttacker;
      await quietDefender;
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
      await closeWS(ws3);
    }
  });

  it('reports no drones remaining when the defender is destroyed', async () => {
    const atk = await createPlayer('atk_wipe', 1, 10, 0);
    const def = await createPlayer('def_wipe', 1, 2, 0);
    const { ws: ws1 } = await connectPlayer(atk.token);
    try {
      const res = await wsRequest(ws1, { type: Commands.AttackShip.name, targetPlayerId: def.id, drones: 5 }, Commands.AttackShip.reply.name);
      assert.equal(res.destroyed, true);
      assert.equal(res.attackerDronesRemaining, 8);
      assert.equal(res.defenderDronesLost, 2);
      assert.equal(res.defenderDronesRemaining, 0);
    } finally {
      await closeWS(ws1);
    }
  });
});

describe('Defender notification', () => {
  async function memosFor(playerId) {
    const res = await pool.query('SELECT kind, body, sender_player_id FROM messages WHERE recipient_player_id = $1 ORDER BY id', [playerId]);
    return res.rows;
  }

  it('tells an online defender live and also mails them', async () => {
    const atk = await createPlayer('atk_alert', 1, 10, 0);
    const def = await createPlayer('def_alert', 1, 1, 5);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2, ready } = await connectPlayer(def.token);
    await ready;
    try {
      const alert = waitForMsg(ws2, Events.ShipAttacked.name);
      await wsRequest(ws1, { type: Commands.AttackShip.name, targetPlayerId: def.id, drones: 3 }, Commands.AttackShip.reply.name);
      const msg = await alert;
      assert.equal(msg.attackerName, 'atk_alert');
      assert.equal(msg.destroyed, false);
      assert.equal(msg.defenderShieldsLost, 3);
      assert.equal(msg.defenderDronesLost, 0);

      const memos = await memosFor(def.id);
      assert.equal(memos.length, 1);
      assert.equal(memos[0].kind, 'ship_attacked');
      assert.equal(memos[0].sender_player_id, atk.id);
      assert.match(memos[0].body, /atk_alert attacked your ship in sector 1\. You lost 3 shield\(s\)\./);
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
    }
  });

  it('mails an offline defender', async () => {
    const atk = await createPlayer('atk_offline', 1, 10, 0);
    const def = await createPlayer('def_offline', 1, 4, 0);
    const { ws: ws1 } = await connectPlayer(atk.token);
    try {
      await wsRequest(ws1, { type: Commands.AttackShip.name, targetPlayerId: def.id, drones: 2 }, Commands.AttackShip.reply.name);
      const memos = await memosFor(def.id);
      assert.equal(memos.length, 1);
      assert.equal(memos[0].kind, 'ship_attacked');
      assert.match(memos[0].body, /You lost 2 drone\(s\)\./);
    } finally {
      await closeWS(ws1);
    }
  });

  it('mails the defender when their ship is destroyed', async () => {
    const atk = await createPlayer('atk_kill', 1, 10, 0);
    const def = await createPlayer('def_kill', 1, 1, 0);
    const { ws: ws1 } = await connectPlayer(atk.token);
    try {
      await wsRequest(ws1, { type: Commands.AttackShip.name, targetPlayerId: def.id, drones: 5 }, Commands.AttackShip.reply.name);
      const memos = await memosFor(def.id);
      assert.equal(memos.length, 1);
      assert.equal(memos[0].kind, 'ship_destroyed');
      assert.match(memos[0].body, /atk_kill destroyed your ship in sector 1\./);
    } finally {
      await closeWS(ws1);
    }
  });
});

describe('Ship destruction', () => {
  it('destroys ship when attacker overwhelms all defenses', async () => {
    const atk = await createPlayer('atk_dest', 1, 10, 0);
    const def = await createPlayer('def_dest', 1, 1, 1);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    try {
      const res = await wsRequest(ws1, { type: Commands.AttackShip.name, targetPlayerId: def.id, drones: 5 }, Commands.AttackShip.reply.name);
      assert.equal(res.type, Commands.AttackShip.reply.name);

      const atkShip = await pool.query('SELECT drones FROM ships WHERE id = (SELECT ship_id FROM players WHERE id = $1)', [atk.id]);
      assert.equal(atkShip.rows[0].drones, 8, 'Attacker should have 8 drones remaining');

      const defShip = await pool.query('SELECT * FROM ships WHERE id = (SELECT ship_id FROM players WHERE id = $1)', [def.id]);
      assert.equal(defShip.rows.length, 0, 'Defender ship should be deleted');
      const defCargo = await pool.query('SELECT * FROM ships WHERE id = (SELECT ship_id FROM players WHERE id = $1)', [def.id]);
      assert.equal(defCargo.rows.length, 0, 'Defender cargo should be deleted');

      const defPlayer = await pool.query('SELECT ship_destroyed_date FROM players WHERE id = $1', [def.id]);
      assert.ok(defPlayer.rows[0].ship_destroyed_date, 'ship_destroyed_date should be set');
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
    }
  });

  it('destroys ship when defender has 0 shields and 0 drones', async () => {
    const atk = await createPlayer('atk_bare', 1, 5, 0);
    const def = await createPlayer('def_bare', 1, 0, 0);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    try {
      const res = await wsRequest(ws1, { type: Commands.AttackShip.name, targetPlayerId: def.id, drones: 1 }, Commands.AttackShip.reply.name);
      assert.equal(res.type, Commands.AttackShip.reply.name);

      const atkShip = await pool.query('SELECT drones FROM ships WHERE id = (SELECT ship_id FROM players WHERE id = $1)', [atk.id]);
      assert.equal(atkShip.rows[0].drones, 5, 'Attacker should still have 5 drones');

      const defShip = await pool.query('SELECT * FROM ships WHERE id = (SELECT ship_id FROM players WHERE id = $1)', [def.id]);
      assert.equal(defShip.rows.length, 0, 'Defender ship should be deleted');

      const defPlayer = await pool.query('SELECT ship_destroyed_date FROM players WHERE id = $1', [def.id]);
      assert.ok(defPlayer.rows[0].ship_destroyed_date, 'ship_destroyed_date should be set');
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
    }
  });

  it('clears the sector of a destroyed player and omits them from the sector display and attack roster', async () => {
    const atk = await createPlayer('atk_gone', 1, 5, 0);
    const def = await createPlayer('def_gone', 1, 0, 0);
    const observer = await createPlayer('obs_gone', 1, 0, 0);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    const { ws: ws3 } = await connectPlayer(observer.token);
    try {
      await wsRequest(ws1, { type: Commands.AttackShip.name, targetPlayerId: def.id, drones: 1 }, Commands.AttackShip.reply.name);

      const display = await wsRequest(ws3, { type: Commands.SectorDisplay.name }, Commands.SectorDisplay.reply.name);
      assert.ok(!display.players.some((p) => p.id === def.id), 'destroyed player must not be listed in the sector');
      assert.ok(display.players.some((p) => p.id === atk.id), 'surviving players are still listed');

      const row = await pool.query('SELECT current_sector_id, previous_sector_id FROM players WHERE id = $1', [def.id]);
      assert.equal(row.rows[0].current_sector_id, null, 'destroyed player should have no sector');
      assert.equal(row.rows[0].previous_sector_id, null, 'destroyed player should have no previous sector');

      const roster = await wsRequest(ws1, { type: Commands.AttackTargets.name }, Commands.AttackTargets.reply.name);
      assert.ok(!roster.players.some((p) => p.id === def.id), 'destroyed player must not be an attack target');

      const again = await wsRequest(ws1, { type: Commands.AttackShip.name, targetPlayerId: def.id, drones: 1 }, Commands.AttackShip.reply.name);
      assert.equal(again.outcome, 'refused');
      assert.equal(again.reason, 'targetNotHere');
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
      await closeWS(ws3);
    }
  });

  it('reports a destroyed clanmate with no sector', async () => {
    const atk = await createPlayer('atk_clan', 1, 5, 0);
    const def = await createPlayer('def_clan', 1, 0, 0);
    const clan = await pool.query(
      `INSERT INTO clans (universe_clan_number, name, password_hash, leader_id, universe_id)
       VALUES ((SELECT COALESCE(MAX(universe_clan_number), 0) + 1 FROM clans WHERE universe_id = $1), $2, 'x', $3, $1)
       RETURNING id`,
      [UNIVERSE_ID, `gone_${Date.now()}`, atk.id],
    );
    await pool.query('UPDATE players SET clan_id = $1 WHERE id = ANY($2)', [clan.rows[0].id, [atk.id, def.id]]);
    const { ws: ws1 } = await connectPlayer(atk.token);
    const { ws: ws2 } = await connectPlayer(def.token);
    try {
      const before = await wsRequest(ws1, { type: Commands.ClanmateLocations.name }, Commands.ClanmateLocations.reply.name);
      assert.equal(before.members.find((m) => m.playerId === def.id).sector, 1);

      await wsRequest(ws1, { type: Commands.AttackShip.name, targetPlayerId: def.id, drones: 1 }, Commands.AttackShip.reply.name);

      const after = await wsRequest(ws1, { type: Commands.ClanmateLocations.name }, Commands.ClanmateLocations.reply.name);
      assert.equal(after.members.find((m) => m.playerId === def.id).sector, null);
    } finally {
      await closeWS(ws1);
      await closeWS(ws2);
    }
  });
});

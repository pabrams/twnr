import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestUser, createTestPlayer } from './helpers.mjs';
import { ensureServer, createPool } from './global-setup.mjs';
import { adminKeyPost, adminKeyDelete } from './admin-helpers.mjs';

const UNIVERSE_ID = 1;

let pool;

before(async () => {
  await ensureServer();
  pool = createPool();
});

after(async () => {
  if (pool) await pool.end();
});

async function historyFor(table, rowId) {
  const res = await pool.query(
    `SELECT universe_id, operation, changed_columns, old_row, new_row FROM row_history
     WHERE table_name = $1 AND row_id = $2 ORDER BY id ASC`,
    [table, rowId],
  );
  return res.rows;
}

async function createPlayer(name) {
  const { userId } = await createTestUser(pool);
  const playerId = await createTestPlayer(pool, userId, UNIVERSE_ID, name, 1, 5, 5);
  const ship = await pool.query('SELECT ship_id FROM players WHERE id = $1', [playerId]);
  return { id: playerId, shipId: ship.rows[0].ship_id };
}

describe('row_history triggers', () => {
  it('records players only when credits change', async () => {
    const { id } = await createPlayer(`rh_credits_${Date.now()}`);
    await pool.query('UPDATE players SET turns = turns - 1 WHERE id = $1', [id]);
    assert.deepEqual(await historyFor('players', id), []);

    await pool.query('UPDATE players SET credits = credits - 250, turns = turns - 1 WHERE id = $1', [id]);
    const rows = await historyFor('players', id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].operation, 'UPDATE');
    assert.deepEqual(rows[0].changed_columns, ['credits']);
    assert.equal(rows[0].universe_id, UNIVERSE_ID);
    assert.equal(rows[0].old_row.credits, 10000);
    assert.equal(rows[0].new_row.credits, 9750);
  });

  it('records ships on tracked columns and on delete, not on drones', async () => {
    const { shipId } = await createPlayer(`rh_ship_${Date.now()}`);
    await pool.query('UPDATE ships SET drones = drones + 1 WHERE id = $1', [shipId]);
    assert.deepEqual(await historyFor('ships', shipId), []);

    await pool.query('UPDATE ships SET shields = 0, holds = holds + 5 WHERE id = $1', [shipId]);
    await pool.query('UPDATE ships SET owner_player_id = NULL WHERE id = $1', [shipId]);
    await pool.query('UPDATE players SET ship_id = NULL WHERE ship_id = $1', [shipId]);
    await pool.query('DELETE FROM ships WHERE id = $1', [shipId]);

    const rows = await historyFor('ships', shipId);
    assert.deepEqual(rows.map((r) => r.operation), ['UPDATE', 'UPDATE', 'DELETE']);
    assert.deepEqual(rows[0].changed_columns, ['holds', 'shields']);
    assert.deepEqual(rows[1].changed_columns, ['owner_player_id']);
    assert.equal(rows[2].new_row, null);
    assert.equal(rows[2].old_row.id, shipId);
  });

  it('records planet_bases on treasury, transporter range, level and delete', async () => {
    const { id: ownerId } = await createPlayer(`rh_base_${Date.now()}`);
    const planet = await pool.query(
      `INSERT INTO planets (sector_id, universe_id, universe_planet_number, name, owner_player_id)
       SELECT s.id, $1, (SELECT COALESCE(MAX(universe_planet_number), 0) + 1 FROM planets WHERE universe_id = $1), $2, $3
       FROM sectors s WHERE s.universe_id = $1 AND s.sector_number = 2 RETURNING id`,
      [UNIVERSE_ID, `BaseWorld_${Date.now()}`, ownerId],
    );
    const planetId = planet.rows[0].id;
    await pool.query(
      `INSERT INTO planet_bases (planet_id, universe_id, level, construction_target_level, construction_started_at, construction_completes_at)
       VALUES ($1, ${UNIVERSE_ID}, 0, 1, NOW(), NOW() + INTERVAL '1 day')`,
      [planetId],
    );
    await pool.query('UPDATE planet_bases SET construction_completes_at = NOW() WHERE planet_id = $1', [planetId]);
    assert.deepEqual(await historyFor('planet_bases', planetId), []);

    await pool.query('UPDATE planet_bases SET level = 1, treasury = 500 WHERE planet_id = $1', [planetId]);
    await pool.query('UPDATE planet_bases SET transporter_range = 3 WHERE planet_id = $1', [planetId]);
    await pool.query('DELETE FROM planets WHERE id = $1', [planetId]);
    const rows = await historyFor('planet_bases', planetId);
    assert.deepEqual(rows.map((r) => r.operation), ['UPDATE', 'UPDATE', 'DELETE']);
    assert.deepEqual(rows.map((r) => r.changed_columns), [['level', 'treasury'], ['transporter_range'], null]);
    assert.equal(rows[0].new_row.treasury, 500);
    assert.equal(rows[2].universe_id, UNIVERSE_ID);
    assert.equal(rows[2].old_row.transporter_range, 3);
  });

  it('does not record the cascade when a universe is deleted', async () => {
    const generated = await adminKeyPost('/api/admin/universes/generate', {
      name: `rh_doomed_${Date.now()}`,
      sectors: 20,
      seed: 7,
    });
    assert.equal(generated.status, 201);
    const universeId = generated.body.id;
    const { userId } = await createTestUser(pool);
    const playerId = await createTestPlayer(pool, userId, universeId, `rh_doomed_p_${Date.now()}`, 1, 0, 0);
    const clan = await pool.query(
      `INSERT INTO clans (universe_id, universe_clan_number, name, password_hash, leader_id)
       VALUES ($1, 1, 'Doomed', 'hash', $2) RETURNING id`,
      [universeId, playerId],
    );
    const before = await pool.query('SELECT COUNT(*)::int AS n FROM row_history WHERE universe_id = $1', [universeId]);
    assert.equal(before.rows[0].n, 1, 'only the clan insert should be recorded so far');

    const deleted = await adminKeyDelete(`/api/admin/universes/${universeId}`);
    assert.equal(deleted.status, 200);
    const after = await pool.query('SELECT COUNT(*)::int AS n FROM row_history WHERE universe_id = $1', [universeId]);
    assert.equal(after.rows[0].n, 1, 'cascading deletes must not be recorded');
    assert.deepEqual((await historyFor('clans', clan.rows[0].id)).map((r) => r.operation), ['INSERT']);
  });

  it('records planets on ownership change and delete, not on production', async () => {
    const { id: ownerId } = await createPlayer(`rh_planet_${Date.now()}`);
    const planet = await pool.query(
      `INSERT INTO planets (sector_id, universe_id, universe_planet_number, name)
       SELECT s.id, $1, (SELECT COALESCE(MAX(universe_planet_number), 0) + 1 FROM planets WHERE universe_id = $1), $2
       FROM sectors s WHERE s.universe_id = $1 AND s.sector_number = 2 RETURNING id`,
      [UNIVERSE_ID, `Claimed_${Date.now()}`],
    );
    const planetId = planet.rows[0].id;
    await pool.query('UPDATE planets SET fuel = fuel + 100 WHERE id = $1', [planetId]);
    assert.deepEqual(await historyFor('planets', planetId), []);

    await pool.query('UPDATE planets SET owner_player_id = $2 WHERE id = $1', [planetId, ownerId]);
    await pool.query('DELETE FROM planets WHERE id = $1', [planetId]);
    const rows = await historyFor('planets', planetId);
    assert.deepEqual(rows.map((r) => r.operation), ['UPDATE', 'DELETE']);
    assert.deepEqual(rows[0].changed_columns, ['owner_player_id']);
    assert.equal(rows[0].new_row.owner_player_id, ownerId);
    assert.equal(rows[1].old_row.owner_player_id, ownerId);
  });

  it('records every clan insert, update and delete', async () => {
    const { id: leaderId } = await createPlayer(`rh_clan_${Date.now()}`);
    const clan = await pool.query(
      `INSERT INTO clans (universe_id, universe_clan_number, name, password_hash, leader_id)
       VALUES ($1, (SELECT COALESCE(MAX(universe_clan_number), 0) + 1 FROM clans WHERE universe_id = $1), $2, 'hash', $3)
       RETURNING id`,
      [UNIVERSE_ID, `History Clan ${Date.now()}`, leaderId],
    );
    const clanId = clan.rows[0].id;
    await pool.query('UPDATE clans SET name = name WHERE id = $1', [clanId]);
    await pool.query(`UPDATE clans SET name = name || ' II' WHERE id = $1`, [clanId]);
    await pool.query('DELETE FROM clans WHERE id = $1', [clanId]);

    const rows = await historyFor('clans', clanId);
    assert.deepEqual(rows.map((r) => r.operation), ['INSERT', 'UPDATE', 'DELETE']);
    assert.equal(rows[0].old_row, null);
    assert.deepEqual(rows[1].changed_columns, ['name']);
    assert.match(rows[2].old_row.name, / II$/);
  });
});

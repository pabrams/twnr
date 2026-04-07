import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAdminUser,
  adminKeyPost, adminKeyGet, adminKeyDelete, adminKeyPut,
} from './admin-helpers.mjs';
import { ensureServer, createPool as _gsCreatePool } from './global-setup.mjs';

let pool;

before(async () => {
  await ensureServer();
  pool = _gsCreatePool();
});

after(async () => {
  if (pool) await pool.end();
});

describe('Admin API - Universe Stats', () => {
  let universeId;

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'StatsUniverse', sectors: 25, seed: 4444,
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;
  });

  it('returns correct stats for an existing universe', async () => {
    const res = await adminKeyGet(`/api/admin/universes/${universeId}/stats`);
    assert.equal(res.status, 200);
    assert.equal(res.body.id, universeId);
    assert.equal(res.body.name, 'StatsUniverse');
    assert.equal(res.body.sectorCount, 25);
    assert.ok(res.body.warpCount > 0);
    assert.ok(res.body.portCount > 0);
    assert.equal(typeof res.body.playerCount, 'number');
    assert.ok(res.body.createdAt, 'Should have createdAt');
    assert.equal(typeof res.body.seed, 'number');
  });

  it('returns 404 for non-existent universe', async () => {
    const res = await adminKeyGet('/api/admin/universes/99999/stats');
    assert.equal(res.status, 404);
    assert.ok(res.body.error.toLowerCase().includes('not found'));
  });
});

describe('Admin API - Delete Universe', () => {
  it('deletes a universe and all associated data', async () => {
    // Create a universe first
    const createRes = await adminKeyPost('/api/admin/universes/generate', {
      name: 'ToDelete', sectors: 20, seed: 5555,
    });
    assert.equal(createRes.status, 201);
    const uid = createRes.body.id;

    // Verify data exists
    const sectorsBefore = await pool.query('SELECT COUNT(*) FROM sectors WHERE universe_id = $1', [uid]);
    assert.ok(parseInt(sectorsBefore.rows[0].count, 10) > 0, 'Should have sectors before delete');

    // Delete
    const delRes = await adminKeyDelete(`/api/admin/universes/${uid}`);
    assert.equal(delRes.status, 200);
    assert.equal(delRes.body.deleted, true);
    assert.equal(delRes.body.id, uid);

    // Verify all data is gone
    const sectorsAfter = await pool.query('SELECT COUNT(*) FROM sectors WHERE universe_id = $1', [uid]);
    assert.equal(parseInt(sectorsAfter.rows[0].count, 10), 0, 'Sectors should be deleted');
    const warpsAfter = await pool.query('SELECT COUNT(*) FROM warps w JOIN sectors s ON w.from_sector_id = s.id WHERE s.universe_id = $1', [uid]);
    assert.equal(parseInt(warpsAfter.rows[0].count, 10), 0, 'Warps should be deleted');
    const portsAfter = await pool.query('SELECT COUNT(*) FROM ports p JOIN sectors s ON p.sector_id = s.id WHERE s.universe_id = $1', [uid]);
    assert.equal(parseInt(portsAfter.rows[0].count, 10), 0, 'Ports should be deleted');
    const univAfter = await pool.query('SELECT COUNT(*) FROM universes WHERE id = $1', [uid]);
    assert.equal(parseInt(univAfter.rows[0].count, 10), 0, 'Universe row should be deleted');
  });

  it('cascade deletes player data', async () => {
    // Create a universe
    const createRes = await adminKeyPost('/api/admin/universes/generate', {
      name: 'CascadeDelete', sectors: 20, seed: 6666,
    });
    assert.equal(createRes.status, 201);
    const uid = createRes.body.id;

    // Create a user and player in this universe
    const { userId } = await createAdminUser(pool);
    const playerRes = await pool.query(
      `INSERT INTO players (name, user_id, universe_id, current_sector_id)
       VALUES ($1, $2, $3, (SELECT id FROM sectors WHERE sector_number = 1 AND universe_id = $3)) RETURNING id`,
      ['TestPlayer', userId, uid],
    );
    const playerId = playerRes.rows[0].id;
    const shipTypeRes = await pool.query(
      `SELECT id FROM ship_types WHERE name = 'Merchant Freighter'`
    );
    const shipTypeId = shipTypeRes.rows[0].id;
    const sectorId = (await pool.query('SELECT id FROM sectors WHERE sector_number = 1 AND universe_id = $1', [uid])).rows[0].id;
    const shipRes2 = await pool.query(
      'INSERT INTO ships (owner_id, ship_type_id, sector_id, drones, shields, holds) VALUES ($1, $2, $3, 0, 0, 5) RETURNING id',
      [playerId, shipTypeId, sectorId],
    );
    await pool.query('UPDATE players SET ship_id = $1, credits = 10000 WHERE id = $2', [shipRes2.rows[0].id, playerId]);
    await pool.query(
      'INSERT INTO visited_sectors (player_id, sector_id) VALUES ($1, 1) ON CONFLICT DO NOTHING',
      [playerId],
    );

    // Verify the data was actually inserted before we delete
    const visitedBefore = await pool.query('SELECT COUNT(*) FROM visited_sectors WHERE player_id = $1', [playerId]);
    assert.ok(parseInt(visitedBefore.rows[0].count, 10) >= 1, 'Should have visited_sectors before delete');

    // Delete the universe
    const delRes = await adminKeyDelete(`/api/admin/universes/${uid}`);
    assert.equal(delRes.status, 200);

    // Small delay to ensure transaction is fully visible
    await new Promise(r => setTimeout(r, 100));

    // Verify player data is gone
    const players = await pool.query('SELECT COUNT(*) FROM players WHERE universe_id = $1', [uid]);
    assert.equal(parseInt(players.rows[0].count, 10), 0, 'Players should be deleted');
    const ships = await pool.query('SELECT COUNT(*) FROM ships WHERE owner_id = $1', [playerId]);
    assert.equal(parseInt(ships.rows[0].count, 10), 0, 'Ships should be deleted');
    const visited = await pool.query('SELECT COUNT(*) FROM visited_sectors WHERE player_id = $1', [playerId]);
    assert.equal(parseInt(visited.rows[0].count, 10), 0, 'Visited sectors should be deleted');
  });

  it('returns 404 for non-existent universe', async () => {
    const res = await adminKeyDelete('/api/admin/universes/99999');
    assert.equal(res.status, 404);
    assert.ok(res.body.error.toLowerCase().includes('not found'));
  });
});

describe('Admin API - Rename Universe', () => {
  let universeId;

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'OriginalName', sectors: 20, seed: 7777,
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;
  });

  it('renames a universe successfully', async () => {
    const res = await adminKeyPut(`/api/admin/universes/${universeId}`, { name: 'RenamedUniverse' });
    assert.equal(res.status, 200);
    assert.equal(res.body.id, universeId);
    assert.equal(res.body.name, 'RenamedUniverse');

    // Verify in DB
    const dbRes = await pool.query('SELECT name FROM universes WHERE id = $1', [universeId]);
    assert.equal(dbRes.rows[0].name, 'RenamedUniverse');
  });

  it('returns 400 when name is missing', async () => {
    const res = await adminKeyPut(`/api/admin/universes/${universeId}`, {});
    assert.equal(res.status, 400);
  });

  it('returns 400 when name is empty', async () => {
    const res = await adminKeyPut(`/api/admin/universes/${universeId}`, { name: '' });
    assert.equal(res.status, 400);
  });

  it('returns 404 for non-existent universe', async () => {
    const res = await adminKeyPut('/api/admin/universes/99999', { name: 'Whatever' });
    assert.equal(res.status, 404);
    assert.ok(res.body.error.toLowerCase().includes('not found'));
  });
});


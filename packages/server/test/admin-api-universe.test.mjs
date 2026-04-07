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
      'INSERT INTO players (name, user_id, universe_id, current_sector) VALUES ($1, $2, $3, 1) RETURNING id',
      ['TestPlayer', userId, uid],
    );
    const playerId = playerRes.rows[0].id;
    await pool.query(
      'INSERT INTO player_ships (player_id, ship_name, drones, shields, cargo_limit) VALUES ($1, $2, 0, 0, 5)',
      [playerId, 'Merchant Freighter'],
    );
    await pool.query(
      'INSERT INTO ship_cargo (player_id, fuel, organics, equipment, credits) VALUES ($1, 0, 0, 0, 10000)',
      [playerId],
    );
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
    const ships = await pool.query('SELECT COUNT(*) FROM player_ships WHERE player_id = $1', [playerId]);
    assert.equal(parseInt(ships.rows[0].count, 10), 0, 'Player ships should be deleted');
    const cargo = await pool.query('SELECT COUNT(*) FROM ship_cargo WHERE player_id = $1', [playerId]);
    assert.equal(parseInt(cargo.rows[0].count, 10), 0, 'Ship cargo should be deleted');
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

describe('Admin API - Clone Universe', () => {
  let sourceId;
  let sourceStats;

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'CloneSource', sectors: 25, seed: 8888,
    });
    assert.equal(res.status, 201);
    sourceId = res.body.id;
    const statsRes = await adminKeyGet(`/api/admin/universes/${sourceId}/stats`);
    sourceStats = statsRes.body;
  });

  it('clones a universe with all sectors, warps, and ports', async () => {
    const res = await adminKeyPost(`/api/admin/universes/${sourceId}/clone`, { name: 'ClonedUniverse' });
    assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.id !== sourceId, 'Cloned universe must have a different ID');
    assert.equal(res.body.name, 'ClonedUniverse');
    assert.equal(res.body.seed, sourceStats.seed, 'Cloned universe must copy seed from source');
    assert.equal(res.body.sectorCount, sourceStats.sectorCount);
    assert.equal(res.body.warpCount, sourceStats.warpCount);
    assert.equal(res.body.portCount, sourceStats.portCount);
  });

  it('cloned universe has matching sector data', async () => {
    const res = await adminKeyPost(`/api/admin/universes/${sourceId}/clone`, { name: 'CloneCheck' });
    assert.equal(res.status, 201);
    const cloneId = res.body.id;

    // Check Federation Space exists at sector 1
    const fedRes = await pool.query(
      'SELECT name FROM sectors WHERE sector_number = 1 AND universe_id = $1', [cloneId]
    );
    assert.equal(fedRes.rows[0].name, 'Federation Space');

    // Check Class 0 port at sector 1
    const port0 = await pool.query(
      'SELECT p.class FROM ports p JOIN sectors s ON p.sector_id = s.id WHERE s.sector_number = 1 AND s.universe_id = $1', [cloneId]
    );
    assert.equal(port0.rows.length, 1);
    assert.equal(port0.rows[0].class, 0);

    // Check Starbase with Class 9
    const sdRes = await pool.query(
      'SELECT s.id FROM sectors s JOIN ports p ON p.sector_id = s.id WHERE s.name = $1 AND s.universe_id = $2 AND p.class = 9',
      ['Starbase', cloneId]
    );
    assert.equal(sdRes.rows.length, 1, 'Cloned universe must have Starbase with Class 9 port');
  });

  it('cloned universe does not copy players', async () => {
    // Add a player to the source universe
    const { userId } = await createAdminUser(pool);
    await pool.query(
      'INSERT INTO players (name, user_id, universe_id, current_sector) VALUES ($1, $2, $3, 1)',
      ['SourcePlayer', userId, sourceId],
    );

    const res = await adminKeyPost(`/api/admin/universes/${sourceId}/clone`, { name: 'NoPlayers' });
    assert.equal(res.status, 201);
    const cloneId = res.body.id;

    const players = await pool.query('SELECT COUNT(*) FROM players WHERE universe_id = $1', [cloneId]);
    assert.equal(parseInt(players.rows[0].count, 10), 0, 'Cloned universe should have no players');
  });

  it('clone copies actual DB data, not re-generated data', async () => {
    // Modify a port in the source universe before cloning
    const tradingPort = await pool.query(
      'SELECT p.sector_id, p.class FROM ports p JOIN sectors s ON p.sector_id = s.id WHERE s.universe_id = $1 AND p.class BETWEEN 1 AND 8 LIMIT 1',
      [sourceId],
    );
    assert.ok(tradingPort.rows.length > 0);
    const modSector = tradingPort.rows[0].sector_id;

    // Set a distinctive quantity that wouldn't come from generation
    await pool.query(
      'UPDATE ports SET fuel = 4999 WHERE sector_id = $1',
      [modSector],
    );

    const res = await adminKeyPost(`/api/admin/universes/${sourceId}/clone`, { name: 'ModifiedClone' });
    assert.equal(res.status, 201);
    const cloneId = res.body.id;

    // The cloned port must have the modified value, not the original generated value
    const clonedPort = await pool.query(
      'SELECT p.fuel FROM ports p JOIN sectors s ON p.sector_id = s.id WHERE s.sector_number = (SELECT sector_number FROM sectors WHERE id = $1) AND s.universe_id = $2',
      [modSector, cloneId],
    );
    assert.equal(clonedPort.rows.length, 1);
    assert.equal(clonedPort.rows[0].fuel, 4999, 'Clone must copy actual DB data, not re-generate');
  });

  it('returns 400 when name is missing', async () => {
    const res = await adminKeyPost(`/api/admin/universes/${sourceId}/clone`, {});
    assert.equal(res.status, 400);
  });

  it('returns 404 for non-existent source universe', async () => {
    const res = await adminKeyPost('/api/admin/universes/99999/clone', { name: 'Ghost' });
    assert.equal(res.status, 404);
    assert.ok(res.body.error.toLowerCase().includes('not found'));
  });
});

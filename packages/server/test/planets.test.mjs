import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { ensureServer, createPool, ADMIN_API_KEY, BASE } from './global-setup.mjs';
import { createTestUser, createTestPlayer as createTestPlayerDB } from './helpers.mjs';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = join(dirname(__filename), '..');

const WS_BASE = 'ws://localhost:3000';
const CONFIG_SHIPS_DIR = join(PROJECT_ROOT, 'config', 'ships');
const SERVER_MESSAGES_TS = join(PROJECT_ROOT, '..', 'shared', 'src', 'server-messages.ts');
const MESSAGES_TS = join(PROJECT_ROOT, '..', 'shared', 'src', 'messages.ts');
const CLIENT_MESSAGES_TS = join(PROJECT_ROOT, '..', 'shared', 'src', 'client-messages.ts');

async function adminKeyPost(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': ADMIN_API_KEY },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

async function adminKeyGet(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'X-Admin-Key': ADMIN_API_KEY },
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

// Create a test user in DB, create a player, and connect via WebSocket.
// Returns { ws, playerId, token, close() }.
let testUserCounter = 0;
async function createTestPlayer(universeId) {
  const suffix = Date.now() + '_' + (++testUserCounter);
  const name = `TestPlayer_${suffix}`;

  // Create user and player directly in DB (bypasses rate limiting)
  const { userId, token } = await createTestUser(pool);
  const playerId = await createTestPlayerDB(pool, userId, universeId, name);

  // Connect WebSocket
  const ws = new WebSocket(`${WS_BASE}/ws?universe=${universeId}`, {
    headers: { Cookie: `twnr_auth=${token}` },
  });

  const messages = [];
  const waiters = [];

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WS connect timeout')), 5000);
    ws.on('open', () => { clearTimeout(timeout); resolve(); });
    ws.on('error', (err) => { clearTimeout(timeout); reject(err); });
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    // Check if any pending waiter wants this message
    let consumed = false;
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].check(msg)) {
        waiters[i].resolve(msg);
        waiters.splice(i, 1);
        consumed = true;
        break;
      }
    }
    // Only queue if no waiter consumed it
    if (!consumed) {
      messages.push(msg);
    }
  });

  function waitForMessage(typeName, timeoutMs = 1500) {
    // Check already-received messages
    const existing = messages.find(m => m.type === typeName);
    if (existing) {
      messages.splice(messages.indexOf(existing), 1);
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${typeName}`)), timeoutMs);
      waiters.push({
        check: (msg) => msg.type === typeName,
        resolve: (msg) => { clearTimeout(timer); resolve(msg); },
      });
    });
  }

  function waitForAny(timeoutMs = 1500) {
    if (messages.length > 0) {
      return Promise.resolve(messages.shift());
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for any message')), timeoutMs);
      waiters.push({
        check: () => true,
        resolve: (msg) => { clearTimeout(timer); resolve(msg); },
      });
    });
  }

  // Navigate to a sector, handling fighter encounters along the way
  async function navigateTo(targetSector, fromSector) {
    sendMsg({ type: 'path', from: fromSector, to: targetSector });
    const pathMsg = await waitForMessage('pathResult');
    for (const sector of pathMsg.path.slice(1)) {
      sendMsg({ type: 'move', sector });
      // Drain messages until we get sectorDisplay, handling fighter encounters
      let moved = false;
      for (let attempt = 0; attempt < 5 && !moved; attempt++) {
        try {
          const msg = await waitForAny(3000);
          if (msg.type === 'sectorDisplay') {
            moved = true;
          } else if (msg.type === 'fighterEncounter') {
            // Retreat from fighters
            sendMsg({ type: 'retreatFromFighters' });
          }
          // Ignore other message types, keep draining
        } catch {
          break; // timeout, move on
        }
      }
    }
  }

  function sendMsg(msg) {
    ws.send(JSON.stringify(msg));
  }

  function close() {
    ws.close();
  }

  // Wait for welcome message
  const welcome = await waitForMessage('welcome');

  return { ws, playerId: welcome.playerId, token, sendMsg, waitForMessage, waitForAny, navigateTo, messages, close };
}

let pool;

before(async () => {
  await ensureServer();
  pool = createPool();
});

after(async () => {
  if (pool) await pool.end().catch(() => {});
});

async function getColumns(table) {
  const res = await pool.query(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_name = $1 AND table_schema = 'public'`,
    [table],
  );
  const cols = {};
  for (const row of res.rows) {
    cols[row.column_name] = {
      data_type: row.data_type,
      is_nullable: row.is_nullable,
      column_default: row.column_default,
    };
  }
  return cols;
}

async function getPKColumns(table) {
  const res = await pool.query(
    `SELECT a.attname
     FROM pg_constraint c
     JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
     WHERE c.conrelid = $1::regclass AND c.contype = 'p'`,
    [table],
  );
  return new Set(res.rows.map(r => r.attname));
}

async function hasUniqueConstraint(table, colSet) {
  const res = await pool.query(
    `SELECT array_agg(a.attname ORDER BY a.attnum) as cols
     FROM pg_constraint c
     JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
     WHERE c.conrelid = $1::regclass AND c.contype = 'u'
     GROUP BY c.oid`,
    [table],
  );
  for (const row of res.rows) {
    const s = new Set(row.cols);
    if (s.size === colSet.size && [...colSet].every(c => s.has(c))) return true;
  }
  return false;
}

// ==================== planets table schema ====================

describe('planets table schema', () => {
  let cols;
  before(async () => { cols = await getColumns('planets'); });

  it('has created_at column (TIMESTAMPTZ NOT NULL)', () => {
    assert.ok(cols.created_at, 'created_at column missing');
    assert.ok(cols.created_at.data_type.includes('timestamp'), `expected timestamp, got ${cols.created_at.data_type}`);
    assert.equal(cols.created_at.is_nullable, 'NO');
  });

  it('has updated_at column (TIMESTAMPTZ)', () => {
    assert.ok(cols.updated_at, 'updated_at column missing');
    assert.ok(cols.updated_at.data_type.includes('timestamp'), `expected timestamp, got ${cols.updated_at.data_type}`);
  });

  it('id is plain INTEGER with no sequence (not SERIAL)', () => {
    assert.ok(cols.id, 'id column missing');
    const def = cols.id.column_default || '';
    assert.ok(!def.includes('nextval'), `id should not use a sequence, got default: ${def}`);
  });

  it('primary key is (id, universe_id)', async () => {
    const pk = await getPKColumns('planets');
    assert.deepStrictEqual(pk, new Set(['id', 'universe_id']));
  });

  it('old UNIQUE(sector_id, universe_id) is removed', async () => {
    const has = await hasUniqueConstraint('planets', new Set(['sector_id', 'universe_id']));
    assert.ok(!has, 'UNIQUE(sector_id, universe_id) should be removed');
  });

  it('colonists column is removed', () => {
    assert.ok(!cols.colonists, 'colonists column should be removed');
  });

  it('has new SMALLINT columns: fighters, fuel, organics, equipment, colonists_fuel, colonists_organics, colonists_equipment', () => {
    const expected = ['fighters', 'fuel', 'organics', 'equipment', 'colonists_fuel', 'colonists_organics', 'colonists_equipment'];
    for (const name of expected) {
      assert.ok(cols[name], `column ${name} missing`);
      assert.ok(cols[name].data_type.includes('smallint'), `${name} should be smallint, got ${cols[name].data_type}`);
      assert.equal(cols[name].is_nullable, 'NO', `${name} should be NOT NULL`);
    }
  });

  it('new SMALLINT columns default to 0', () => {
    const expected = ['fighters', 'fuel', 'organics', 'equipment', 'colonists_fuel', 'colonists_organics', 'colonists_equipment'];
    for (const name of expected) {
      assert.ok(cols[name].column_default !== null, `${name} should have a default`);
      assert.ok(cols[name].column_default.includes('0'), `${name} default should be 0, got ${cols[name].column_default}`);
    }
  });
});

// ==================== planets triggers ====================

describe('planets triggers', () => {
  let univId;

  before(async () => {
    const res = await pool.query("INSERT INTO universes (name, seed) VALUES ('trigger_test', 1) RETURNING id");
    univId = res.rows[0].id;
    await pool.query('INSERT INTO sectors (id, universe_id, name) VALUES (1, $1, $2)', [univId, 'S1']);
  });

  after(async () => {
    await pool.query('DELETE FROM planets WHERE universe_id = $1', [univId]);
    await pool.query('DELETE FROM sectors WHERE universe_id = $1', [univId]);
    await pool.query('DELETE FROM universes WHERE id = $1', [univId]);
  });

  it('sets created_at on INSERT', async () => {
    await pool.query(
      "INSERT INTO planets (id, sector_id, universe_id, name, type) VALUES (1, 1, $1, 'TriggerWorld', 'Terran')",
      [univId],
    );
    const res = await pool.query('SELECT created_at FROM planets WHERE id = 1 AND universe_id = $1', [univId]);
    assert.ok(res.rows[0].created_at, 'created_at should be set on insert');
  });

  it('sets updated_at on UPDATE', async () => {
    await new Promise(r => setTimeout(r, 100));
    await pool.query("UPDATE planets SET name = 'TriggerWorld2' WHERE id = 1 AND universe_id = $1", [univId]);
    const res = await pool.query('SELECT updated_at, created_at FROM planets WHERE id = 1 AND universe_id = $1', [univId]);
    assert.ok(res.rows[0].updated_at, 'updated_at should be set on update');
    assert.ok(res.rows[0].updated_at >= res.rows[0].created_at, 'updated_at should be >= created_at');
  });
});

// ==================== multiple planets per sector ====================

describe('multiple planets per sector', () => {
  it('allows inserting multiple planets in the same sector', async () => {
    const res = await pool.query("INSERT INTO universes (name, seed) VALUES ('multi_test', 2) RETURNING id");
    const uid = res.rows[0].id;
    await pool.query('INSERT INTO sectors (id, universe_id, name) VALUES (1, $1, $2)', [uid, 'S1']);
    await pool.query("INSERT INTO planets (id, sector_id, universe_id, name, type) VALUES (1, 1, $1, 'P1', 'Terran')", [uid]);
    await pool.query("INSERT INTO planets (id, sector_id, universe_id, name, type) VALUES (2, 1, $1, 'P2', 'Oceanic')", [uid]);
    const count = await pool.query('SELECT COUNT(*)::int as cnt FROM planets WHERE sector_id = 1 AND universe_id = $1', [uid]);
    assert.equal(count.rows[0].cnt, 2);

    await pool.query('DELETE FROM planets WHERE universe_id = $1', [uid]);
    await pool.query('DELETE FROM sectors WHERE universe_id = $1', [uid]);
    await pool.query('DELETE FROM universes WHERE id = $1', [uid]);
  });
});

// ==================== universes table ====================

describe('universes table', () => {
  let cols;
  before(async () => { cols = await getColumns('universes'); });

  it('has max_planets_per_sector (SMALLINT NOT NULL)', () => {
    assert.ok(cols.max_planets_per_sector, 'max_planets_per_sector missing');
    assert.ok(cols.max_planets_per_sector.data_type.includes('smallint'));
    assert.equal(cols.max_planets_per_sector.is_nullable, 'NO');
  });

  it('has planet_collision_likelihood (SMALLINT NOT NULL)', () => {
    assert.ok(cols.planet_collision_likelihood, 'planet_collision_likelihood missing');
    assert.ok(cols.planet_collision_likelihood.data_type.includes('smallint'));
    assert.equal(cols.planet_collision_likelihood.is_nullable, 'NO');
  });

  it('has planet_collision_min_hours and max_hours (SMALLINT NOT NULL)', () => {
    for (const name of ['planet_collision_min_hours', 'planet_collision_max_hours']) {
      assert.ok(cols[name], `${name} missing`);
      assert.ok(cols[name].data_type.includes('smallint'), `${name} should be smallint`);
      assert.equal(cols[name].is_nullable, 'NO', `${name} should be NOT NULL`);
    }
  });

  it('defaults are correct (2, 50, 24, 24)', async () => {
    const res = await pool.query("INSERT INTO universes (name, seed) VALUES ('defaults_test', 99) RETURNING id");
    const uid = res.rows[0].id;
    const row = await pool.query(
      `SELECT max_planets_per_sector, planet_collision_likelihood,
              planet_collision_min_hours, planet_collision_max_hours
       FROM universes WHERE id = $1`, [uid],
    );
    const r = row.rows[0];
    assert.equal(r.max_planets_per_sector, 2);
    assert.equal(r.planet_collision_likelihood, 50);
    assert.equal(r.planet_collision_min_hours, 24);
    assert.equal(r.planet_collision_max_hours, 24);
    await pool.query('DELETE FROM universes WHERE id = $1', [uid]);
  });
});

// ==================== planet_collisions table ====================

describe('planet_collisions table', () => {
  let cols;
  before(async () => { cols = await getColumns('planet_collisions'); });

  it('exists with required columns', () => {
    assert.ok(cols.collision_planet, 'collision_planet missing');
    assert.ok(cols.colliding_with, 'colliding_with missing');
    assert.ok(cols.universe_id, 'universe_id missing');
    assert.ok(cols.collision_at, 'collision_at missing');
    assert.ok(cols.collision_at.data_type.includes('timestamp'));
    assert.equal(cols.collision_at.is_nullable, 'NO');
  });

  it('primary key is (collision_planet, colliding_with, universe_id)', async () => {
    const pk = await getPKColumns('planet_collisions');
    assert.deepStrictEqual(pk, new Set(['collision_planet', 'colliding_with', 'universe_id']));
  });

  it('cascade deletes when collision_planet is deleted', async () => {
    const res = await pool.query("INSERT INTO universes (name, seed) VALUES ('cascade_test', 3) RETURNING id");
    const uid = res.rows[0].id;
    await pool.query('INSERT INTO sectors (id, universe_id, name) VALUES (1, $1, $2)', [uid, 'S1']);
    await pool.query('INSERT INTO sectors (id, universe_id, name) VALUES (2, $1, $2)', [uid, 'S2']);
    await pool.query("INSERT INTO planets (id, sector_id, universe_id, name, type) VALUES (1, 1, $1, 'P1', 'Terran')", [uid]);
    await pool.query("INSERT INTO planets (id, sector_id, universe_id, name, type) VALUES (2, 2, $1, 'P2', 'Oceanic')", [uid]);
    await pool.query(
      "INSERT INTO planet_collisions (collision_planet, colliding_with, universe_id, collision_at) VALUES (1, 2, $1, NOW() + interval '24 hours')",
      [uid],
    );
    const before = await pool.query('SELECT COUNT(*)::int as cnt FROM planet_collisions WHERE universe_id = $1', [uid]);
    assert.equal(before.rows[0].cnt, 1);

    await pool.query('DELETE FROM planets WHERE id = 1 AND universe_id = $1', [uid]);
    const afterDel = await pool.query('SELECT COUNT(*)::int as cnt FROM planet_collisions WHERE universe_id = $1', [uid]);
    assert.equal(afterDel.rows[0].cnt, 0, 'collision row should be deleted when collision_planet is deleted');

    await pool.query('DELETE FROM planets WHERE universe_id = $1', [uid]);
    await pool.query('DELETE FROM sectors WHERE universe_id = $1', [uid]);
    await pool.query('DELETE FROM universes WHERE id = $1', [uid]);
  });

  it('cascade deletes when colliding_with planet is deleted', async () => {
    const res = await pool.query("INSERT INTO universes (name, seed) VALUES ('cascade2_test', 4) RETURNING id");
    const uid = res.rows[0].id;
    await pool.query('INSERT INTO sectors (id, universe_id, name) VALUES (1, $1, $2)', [uid, 'S1']);
    await pool.query("INSERT INTO planets (id, sector_id, universe_id, name, type) VALUES (1, 1, $1, 'PA', 'Terran')", [uid]);
    await pool.query("INSERT INTO planets (id, sector_id, universe_id, name, type) VALUES (2, 1, $1, 'PB', 'Oceanic')", [uid]);
    await pool.query(
      "INSERT INTO planet_collisions (collision_planet, colliding_with, universe_id, collision_at) VALUES (1, 2, $1, NOW() + interval '24 hours')",
      [uid],
    );

    await pool.query('DELETE FROM planets WHERE id = 2 AND universe_id = $1', [uid]);
    const afterDel = await pool.query('SELECT COUNT(*)::int as cnt FROM planet_collisions WHERE universe_id = $1', [uid]);
    assert.equal(afterDel.rows[0].cnt, 0, 'collision row should be deleted when colliding_with planet is deleted');

    await pool.query('DELETE FROM planets WHERE universe_id = $1', [uid]);
    await pool.query('DELETE FROM sectors WHERE universe_id = $1', [uid]);
    await pool.query('DELETE FROM universes WHERE id = $1', [uid]);
  });
});

// ==================== players table: on_planet_id ====================

describe('players table on_planet_id', () => {
  let cols;
  before(async () => { cols = await getColumns('players'); });

  it('has on_planet_id column (INTEGER, nullable)', () => {
    assert.ok(cols.on_planet_id, 'on_planet_id column missing');
    assert.ok(cols.on_planet_id.data_type.includes('integer'), `expected integer, got ${cols.on_planet_id.data_type}`);
    assert.equal(cols.on_planet_id.is_nullable, 'YES', 'on_planet_id should be nullable');
  });
});

// ==================== player_ships table ====================

describe('player_ships table', () => {
  let cols;
  before(async () => { cols = await getColumns('player_ships'); });

  it('has planet_busters (SMALLINT NOT NULL DEFAULT 0)', () => {
    assert.ok(cols.planet_busters, 'planet_busters missing');
    assert.ok(cols.planet_busters.data_type.includes('smallint'));
    assert.equal(cols.planet_busters.is_nullable, 'NO');
  });

  it('has terraform_devices (SMALLINT NOT NULL DEFAULT 0)', () => {
    assert.ok(cols.terraform_devices, 'terraform_devices missing');
    assert.ok(cols.terraform_devices.data_type.includes('smallint'));
    assert.equal(cols.terraform_devices.is_nullable, 'NO');
  });
});

// ==================== Ship config files ====================

describe('ship config files', () => {
  let shipFiles;
  let configs;

  before(() => {
    shipFiles = readdirSync(CONFIG_SHIPS_DIR).filter(f => f.endsWith('.json'));
    configs = shipFiles.map(f => ({
      file: f,
      data: JSON.parse(readFileSync(join(CONFIG_SHIPS_DIR, f), 'utf8')),
    }));
  });

  it('all ship configs have maxPlanetBusters (int 0-20)', () => {
    for (const { file, data } of configs) {
      assert.ok('maxPlanetBusters' in data, `${file} missing maxPlanetBusters`);
      assert.ok(Number.isInteger(data.maxPlanetBusters), `${file} maxPlanetBusters not integer`);
      assert.ok(data.maxPlanetBusters >= 0 && data.maxPlanetBusters <= 20, `${file} maxPlanetBusters=${data.maxPlanetBusters} out of range`);
    }
  });

  it('all ship configs have maxTerraformDevices (int 0-20)', () => {
    for (const { file, data } of configs) {
      assert.ok('maxTerraformDevices' in data, `${file} missing maxTerraformDevices`);
      assert.ok(Number.isInteger(data.maxTerraformDevices), `${file} maxTerraformDevices not integer`);
      assert.ok(data.maxTerraformDevices >= 0 && data.maxTerraformDevices <= 20, `${file} maxTerraformDevices=${data.maxTerraformDevices} out of range`);
    }
  });

  it('Merchant Freighter has maxPlanetBusters=0 and maxTerraformDevices=1', () => {
    const merchant = configs.find(c => c.data.name === 'Merchant Freighter');
    assert.ok(merchant, 'Merchant Freighter config not found');
    assert.equal(merchant.data.maxPlanetBusters, 0);
    assert.equal(merchant.data.maxTerraformDevices, 1);
  });

  it('many ships (>=3) have 0 for both fields', () => {
    const zeroBusters = configs.filter(c => c.data.maxPlanetBusters === 0).length;
    const zeroTerraform = configs.filter(c => c.data.maxTerraformDevices === 0).length;
    assert.ok(zeroBusters >= 3, `only ${zeroBusters} ships have maxPlanetBusters=0, expected >=3`);
    assert.ok(zeroTerraform >= 3, `only ${zeroTerraform} ships have maxTerraformDevices=0, expected >=3`);
  });
});

// ==================== Ship catalog API includes new fields ====================

describe('ship catalog API', () => {
  it('GET /api/ships includes maxPlanetBusters and maxTerraformDevices', async () => {
    const res = await fetch(`${BASE}/api/ships`);
    assert.equal(res.status, 200);
    const ships = await res.json();
    assert.ok(Array.isArray(ships), 'should return an array');
    assert.ok(ships.length > 0, 'should have at least one ship');
    for (const ship of ships) {
      assert.ok('maxPlanetBusters' in ship, `${ship.name} missing maxPlanetBusters in API response`);
      assert.ok('maxTerraformDevices' in ship, `${ship.name} missing maxTerraformDevices in API response`);
    }
  });
});

// ==================== Admin API: max_planets_per_sector ====================

describe('admin API max_planets_per_sector', () => {
  it('stores max_planets_per_sector when provided', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'MppsTest', sectors: 20, seed: 50001, max_planets_per_sector: 5,
    });
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    const uid = res.body.id;
    const row = await pool.query('SELECT max_planets_per_sector FROM universes WHERE id = $1', [uid]);
    assert.equal(row.rows[0].max_planets_per_sector, 5);
  });

  it('defaults to 2 when max_planets_per_sector is not provided', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'MppsDefault', sectors: 20, seed: 50002,
    });
    assert.equal(res.status, 201);
    const uid = res.body.id;
    const row = await pool.query('SELECT max_planets_per_sector FROM universes WHERE id = $1', [uid]);
    assert.equal(row.rows[0].max_planets_per_sector, 2);
  });

  it('rejects max_planets_per_sector outside 0-25 with 400', async () => {
    const res1 = await adminKeyPost('/api/admin/universes/generate', {
      name: 'MppsBad1', sectors: 20, seed: 50003, max_planets_per_sector: -1,
    });
    assert.equal(res1.status, 400, 'should reject -1');

    const res2 = await adminKeyPost('/api/admin/universes/generate', {
      name: 'MppsBad2', sectors: 20, seed: 50004, max_planets_per_sector: 26,
    });
    assert.equal(res2.status, 400, 'should reject 26');
  });

  it('accepts boundary values 0 and 25', async () => {
    const res0 = await adminKeyPost('/api/admin/universes/generate', {
      name: 'MppsZero', sectors: 20, seed: 50005, max_planets_per_sector: 0,
    });
    assert.equal(res0.status, 201);
    const row0 = await pool.query('SELECT max_planets_per_sector FROM universes WHERE id = $1', [res0.body.id]);
    assert.equal(row0.rows[0].max_planets_per_sector, 0);

    const res25 = await adminKeyPost('/api/admin/universes/generate', {
      name: 'MppsMax', sectors: 20, seed: 50006, max_planets_per_sector: 25,
    });
    assert.equal(res25.status, 201);
    const row25 = await pool.query('SELECT max_planets_per_sector FROM universes WHERE id = $1', [res25.body.id]);
    assert.equal(row25.rows[0].max_planets_per_sector, 25);
  });
});

// ==================== Planet ID calculation ====================

describe('planet ID calculation during universe creation', () => {
  it('Earth gets id=1 when a universe is created', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'PlanetIdTest', sectors: 20, seed: 60001,
    });
    assert.equal(res.status, 201);
    const uid = res.body.id;
    const planets = await pool.query(
      'SELECT id, name FROM planets WHERE universe_id = $1 ORDER BY id',
      [uid],
    );
    assert.ok(planets.rows.length >= 1, 'should have at least one planet (Earth)');
    const earth = planets.rows.find(p => p.name === 'Earth');
    assert.ok(earth, 'Earth planet should exist');
    assert.equal(earth.id, 1, 'Earth should have id=1');
  });

  it('two universes each have independent planet IDs starting at 1', async () => {
    const res1 = await adminKeyPost('/api/admin/universes/generate', {
      name: 'IdIndep1', sectors: 20, seed: 60002,
    });
    const res2 = await adminKeyPost('/api/admin/universes/generate', {
      name: 'IdIndep2', sectors: 20, seed: 60003,
    });
    assert.equal(res1.status, 201);
    assert.equal(res2.status, 201);

    const p1 = await pool.query('SELECT id FROM planets WHERE universe_id = $1 AND name = $2', [res1.body.id, 'Earth']);
    const p2 = await pool.query('SELECT id FROM planets WHERE universe_id = $1 AND name = $2', [res2.body.id, 'Earth']);
    assert.equal(p1.rows[0].id, 1, 'Earth in universe 1 should have id=1');
    assert.equal(p2.rows[0].id, 1, 'Earth in universe 2 should have id=1');
  });
});

// ==================== Shared TypeScript types ====================

describe('shared TypeScript types', () => {
  let serverMsgContent;
  let msgContent;
  let clientMsgContent;

  before(() => {
    assert.ok(existsSync(SERVER_MESSAGES_TS), `${SERVER_MESSAGES_TS} not found`);
    serverMsgContent = readFileSync(SERVER_MESSAGES_TS, 'utf8');
    assert.ok(existsSync(MESSAGES_TS), `${MESSAGES_TS} not found`);
    msgContent = readFileSync(MESSAGES_TS, 'utf8');
    if (existsSync(CLIENT_MESSAGES_TS)) {
      clientMsgContent = readFileSync(CLIENT_MESSAGES_TS, 'utf8');
    }
  });

  it('SectorDisplayMessage type includes planets field', () => {
    // Find the type/interface block by matching from declaration to the next export or end
    const match = serverMsgContent.match(/(?:type|interface)\s+SectorDisplayMessage\b[\s\S]*?(?=\nexport\s|\n\/\/\s*=|$)/);
    assert.ok(match, 'SectorDisplayMessage type definition not found');
    const block = match[0].toLowerCase();
    assert.ok(block.includes('planet'), 'SectorDisplayMessage should include a planets field');
  });

  it('ShipInfoMessage type includes planet buster and terraform device fields', () => {
    const match = serverMsgContent.match(/(?:type|interface)\s+ShipInfoMessage\b[\s\S]*?(?=\nexport\s|\n\/\/\s*=|$)/);
    assert.ok(match, 'ShipInfoMessage type definition not found');
    const block = match[0].toLowerCase();
    assert.ok(
      block.includes('maxplanetbusters') || block.includes('max_planet_busters'),
      'ShipInfoMessage should include maxPlanetBusters',
    );
    assert.ok(
      block.includes('maxterraformdevices') || block.includes('max_terraform_devices'),
      'ShipInfoMessage should include maxTerraformDevices',
    );
    assert.ok(
      block.includes('planetbusters') || block.includes('planet_busters'),
      'ShipInfoMessage should include planetBusters (current count)',
    );
    assert.ok(
      block.includes('terraformdevices') || block.includes('terraform_devices'),
      'ShipInfoMessage should include terraformDevices (current count)',
    );
  });

  it('ServerMsgType has new planet-related message types', () => {
    const lower = msgContent.toLowerCase();
    const requiredServerTypes = ['terraformresult', 'planetlist', 'planetdisplayresult', 'destroyplanetresult', 'buyhardwareresult', 'stardockmenu'];
    for (const typeName of requiredServerTypes) {
      assert.ok(lower.includes(typeName), `ServerMsgType missing ${typeName}`);
    }
  });

  it('ClientMsgType has new planet-related message types', () => {
    const lower = msgContent.toLowerCase();
    const requiredClientTypes = ['useterraformdevice', 'landonplanet', 'planetdisplay', 'destroyplanet', 'leaveplanet', 'buyplanetbusters', 'buyterraformdevices', 'dockstardock', 'leavestardock'];
    for (const typeName of requiredClientTypes) {
      assert.ok(lower.includes(typeName), `ClientMsgType missing ${typeName}`);
    }
  });

  it('server message type definitions exist for new types', () => {
    const lower = serverMsgContent.toLowerCase();
    assert.ok(lower.includes('terraformresult'), 'TerraformResult type definition missing');
    assert.ok(lower.includes('planetlist'), 'PlanetList type definition missing');
    assert.ok(lower.includes('planetdisplayresult'), 'PlanetDisplayResult type definition missing');
    assert.ok(lower.includes('destroyplanetresult'), 'DestroyPlanetResult type definition missing');
    assert.ok(lower.includes('buyhardwareresult'), 'BuyHardwareResult type definition missing');
    assert.ok(lower.includes('stardockmenu'), 'StardockMenu type definition missing');
  });

  it('client message type definitions exist in client-messages.ts', () => {
    assert.ok(clientMsgContent, 'client-messages.ts should exist');
    const lower = clientMsgContent.toLowerCase();
    const requiredTypes = ['useterraformdevice', 'landonplanet', 'planetdisplay', 'destroyplanet', 'leaveplanet', 'buyplanetbusters', 'buyterraformdevices', 'dockstardock', 'leavestardock'];
    for (const typeName of requiredTypes) {
      assert.ok(lower.includes(typeName), `client-messages.ts missing type definition for ${typeName}`);
    }
  });

});

// ==================== WebSocket: sector display includes planets ====================

describe('WS: sector display includes planets', () => {
  let universeId;
  let player;

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'WsSectorPlanets', sectors: 20, seed: 70001,
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;
    player = await createTestPlayer(universeId);
  });

  after(() => { player?.close(); });

  it('sectorDisplay message includes planets array', async () => {
    player.sendMsg({ type: 'sectorDisplay' });
    const msg = await player.waitForMessage('sectorDisplay');
    assert.ok('planets' in msg, 'sectorDisplay should include planets field');
    assert.ok(Array.isArray(msg.planets), 'planets should be an array');
  });

  it('sector 1 planets array contains Earth with id, name, type', async () => {
    // Player starts in sector 1 which has Earth
    player.sendMsg({ type: 'sectorDisplay' });
    const msg = await player.waitForMessage('sectorDisplay');
    assert.ok(msg.planets.length >= 1, 'sector 1 should have at least Earth');
    const earth = msg.planets.find(p => p.name === 'Earth');
    assert.ok(earth, 'Earth should be in sector 1 planets');
    assert.ok('id' in earth, 'planet should have id');
    assert.ok('name' in earth, 'planet should have name');
    assert.ok('type' in earth, 'planet should have type');
    assert.equal(earth.id, 1, 'Earth should have id=1');
  });

  it('sector with no planets returns empty planets array', async () => {
    // Move to a sector that has no planets
    const warps = await pool.query(
      'SELECT w.sector_to FROM warps w WHERE w.sector_from = 1 AND w.universe_id = $1 LIMIT 1',
      [universeId],
    );
    assert.ok(warps.rows.length > 0, 'need a warp target from sector 1');
    const targetSector = warps.rows[0].sector_to;

    // Ensure no planets in that sector
    await pool.query('DELETE FROM planets WHERE sector_id = $1 AND universe_id = $2', [targetSector, universeId]);

    player.sendMsg({ type: 'move', sector: targetSector });
    await player.waitForMessage('sectorDisplay');

    player.sendMsg({ type: 'sectorDisplay' });
    const msg = await player.waitForMessage('sectorDisplay');
    assert.ok('planets' in msg, 'sectorDisplay should include planets field');
    assert.ok(Array.isArray(msg.planets), 'planets should be an array');
    assert.equal(msg.planets.length, 0, 'sector with no planets should return empty array');
  });
});

// ==================== WS: ship info includes planet busters and terraform devices ====================

describe('WS: ship info includes new fields', () => {
  let universeId;
  let player;

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'WsShipInfo', sectors: 20, seed: 70002,
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;
    player = await createTestPlayer(universeId);
  });

  after(() => { player?.close(); });

  it('shipInfo message includes maxPlanetBusters, maxTerraformDevices, planetBusters, terraformDevices', async () => {
    player.sendMsg({ type: 'ship' });
    const msg = await player.waitForMessage('shipInfo');
    assert.ok('maxPlanetBusters' in msg, 'shipInfo should include maxPlanetBusters');
    assert.ok('maxTerraformDevices' in msg, 'shipInfo should include maxTerraformDevices');
    assert.ok('planetBusters' in msg, 'shipInfo should include planetBusters');
    assert.ok('terraformDevices' in msg, 'shipInfo should include terraformDevices');
    assert.equal(typeof msg.maxPlanetBusters, 'number');
    assert.equal(typeof msg.maxTerraformDevices, 'number');
    assert.equal(msg.planetBusters, 0, 'new player should have 0 planet busters');
    assert.equal(msg.terraformDevices, 0, 'new player should have 0 terraform devices');
  });
});

// ==================== WS: land command returns planet list ====================

describe('WS: land command returns planet list', () => {
  let universeId;
  let player;

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'WsLandList', sectors: 20, seed: 70003,
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;
    player = await createTestPlayer(universeId);
  });

  after(() => { player?.close(); });

  it('land command responds with planetList message', async () => {
    player.sendMsg({ type: 'land' });
    const msg = await player.waitForMessage('planetList');
    assert.ok('planets' in msg, 'planetList should include planets field');
    assert.ok(Array.isArray(msg.planets), 'planets should be an array');
  });

  it('planetList in sector 1 includes Earth', async () => {
    player.sendMsg({ type: 'land' });
    const msg = await player.waitForMessage('planetList');
    assert.ok(msg.planets.length >= 1, 'sector 1 should have Earth');
    const earth = msg.planets.find(p => p.name === 'Earth');
    assert.ok(earth, 'Earth should be in planet list');
    assert.ok('id' in earth, 'planet should have id');
    assert.ok('type' in earth, 'planet should have type');
  });

  it('land command in sector with no planets returns empty planetList', async () => {
    // Move to a sector with no planets
    const warps = await pool.query(
      'SELECT w.sector_to FROM warps w WHERE w.sector_from = 1 AND w.universe_id = $1 LIMIT 1',
      [universeId],
    );
    assert.ok(warps.rows.length > 0, 'need a warp target from sector 1');
    const targetSector = warps.rows[0].sector_to;

    // Ensure no planets in that sector
    await pool.query('DELETE FROM planets WHERE sector_id = $1 AND universe_id = $2', [targetSector, universeId]);

    player.sendMsg({ type: 'move', sector: targetSector });
    await player.waitForMessage('sectorDisplay');

    player.sendMsg({ type: 'land' });
    const msg = await player.waitForMessage('planetList');
    assert.ok('planets' in msg, 'planetList should include planets field');
    assert.ok(Array.isArray(msg.planets), 'planets should be an array');
    assert.equal(msg.planets.length, 0, 'land in sector with no planets should return empty array');
  });
});

// ==================== WS: land on planet, display, leave ====================

describe('WS: land on planet, display, leave', () => {
  let universeId;
  let player;

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'WsLandOnPlanet', sectors: 20, seed: 70004,
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;
    player = await createTestPlayer(universeId);
  });

  after(() => { player?.close(); });

  it('landOnPlanet with valid planetId responds with planetDisplayResult', async () => {
    // Get the planet id for Earth
    const planets = await pool.query(
      "SELECT id FROM planets WHERE universe_id = $1 AND name = 'Earth'",
      [universeId],
    );
    const earthId = planets.rows[0].id;

    player.sendMsg({ type: 'landOnPlanet', planetId: earthId });
    const msg = await player.waitForMessage('planetDisplayResult');
    assert.ok(msg, 'should receive planetDisplayResult');
    assert.equal(msg.id, earthId);
    assert.equal(msg.name, 'Earth');
    assert.ok('type' in msg, 'should include type');
    assert.ok('fighters' in msg, 'should include fighters');
    assert.ok('fuel' in msg, 'should include fuel');
    assert.ok('organics' in msg, 'should include organics');
    assert.ok('equipment' in msg, 'should include equipment');
    assert.ok('colonists_fuel' in msg || 'colonistsFuel' in msg, 'should include colonists_fuel');
    assert.ok('colonists_organics' in msg || 'colonistsOrganics' in msg, 'should include colonists_organics');
    assert.ok('colonists_equipment' in msg || 'colonistsEquipment' in msg, 'should include colonists_equipment');
    assert.ok('sector_id' in msg || 'sectorId' in msg, 'should include sector_id');
    assert.ok('created_at' in msg || 'createdAt' in msg, 'should include created_at');
    assert.ok('updated_at' in msg || 'updatedAt' in msg, 'should include updated_at');
    assert.ok(!('universe_id' in msg) && !('universeId' in msg), 'planetDisplayResult should NOT include universe_id');
  });

  it('landOnPlanet sets on_planet_id in the players table', async () => {
    const res = await pool.query('SELECT on_planet_id FROM players WHERE id = $1', [player.playerId]);
    assert.ok(res.rows[0].on_planet_id !== null, 'on_planet_id should be set after landing');
  });

  it('planetDisplay while on planet returns planet details', async () => {
    player.sendMsg({ type: 'planetDisplay' });
    const msg = await player.waitForMessage('planetDisplayResult');
    assert.ok(msg, 'should receive planetDisplayResult');
    assert.equal(msg.name, 'Earth');
  });

  it('leavePlanet returns sectorDisplay', async () => {
    player.sendMsg({ type: 'leavePlanet' });
    const msg = await player.waitForMessage('sectorDisplay');
    assert.ok(msg, 'should receive sectorDisplay after leaving planet');
    assert.ok('planets' in msg, 'sectorDisplay should include planets');
  });

  it('on_planet_id is cleared after leaving planet', async () => {
    const res = await pool.query('SELECT on_planet_id FROM players WHERE id = $1', [player.playerId]);
    assert.equal(res.rows[0].on_planet_id, null, 'on_planet_id should be null after leaving');
  });
});

// ==================== WS: terraform device ====================

describe('WS: use terraform device', () => {
  let universeId;
  let player;

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'WsTerraform', sectors: 20, seed: 70005,
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;
    player = await createTestPlayer(universeId);
  });

  after(() => { player?.close(); });

  it('useTerraformDevice with 0 devices returns no_devices', async () => {
    // Move to a non-restricted sector first
    const warps = await pool.query(
      'SELECT sector_to FROM warps WHERE sector_from = 1 AND universe_id = $1 LIMIT 1',
      [universeId],
    );
    if (warps.rows.length > 0) {
      const target = warps.rows[0].sector_to;
      player.sendMsg({ type: 'move', sector: target });
      await player.waitForMessage('sectorDisplay');
    }

    player.sendMsg({ type: 'useTerraformDevice' });
    const msg = await player.waitForMessage('terraformResult');
    assert.equal(msg.success, false);
    assert.equal(msg.reason, 'no_devices');
    assert.ok('terraformDevices' in msg, 'no_devices response should include terraformDevices count');
    assert.equal(msg.terraformDevices, 0, 'terraformDevices should be 0');
  });

  it('useTerraformDevice in sector 1 returns restricted_sector', async () => {
    // Give the player a terraform device via DB
    await pool.query('UPDATE player_ships SET terraform_devices = 1 WHERE player_id = $1', [player.playerId]);

    // Move back to sector 1
    const currentSector = (await pool.query('SELECT current_sector FROM players WHERE id = $1', [player.playerId])).rows[0].current_sector;
    if (currentSector !== 1) {
      // Navigate back — find a path
      player.sendMsg({ type: 'path', from: currentSector, to: 1 });
      const pathMsg = await player.waitForMessage('pathResult');
      for (const sector of pathMsg.path.slice(1)) {
        player.sendMsg({ type: 'move', sector });
        await player.waitForMessage('sectorDisplay');
      }
    }

    player.sendMsg({ type: 'useTerraformDevice' });
    const msg = await player.waitForMessage('terraformResult');
    assert.equal(msg.success, false);
    assert.equal(msg.reason, 'restricted_sector');

    // Terraform device should NOT have been consumed
    const shipRes = await pool.query('SELECT terraform_devices FROM player_ships WHERE player_id = $1', [player.playerId]);
    assert.equal(shipRes.rows[0].terraform_devices, 1, 'device should not be consumed on restricted sector');
  });

  it('useTerraformDevice in a valid sector creates a planet', async () => {
    // Move to a non-restricted, non-Stardock sector
    const warps = await pool.query(
      "SELECT w.sector_to FROM warps w JOIN sectors s ON s.id = w.sector_to AND s.universe_id = w.universe_id WHERE w.sector_from = 1 AND w.universe_id = $1 AND s.name != 'Stardock' LIMIT 1",
      [universeId],
    );
    assert.ok(warps.rows.length > 0, 'should have a warp from sector 1');
    const targetSector = warps.rows[0].sector_to;

    player.sendMsg({ type: 'move', sector: targetSector });
    await player.waitForMessage('sectorDisplay');

    // Give the player a terraform device
    await pool.query('UPDATE player_ships SET terraform_devices = 1 WHERE player_id = $1', [player.playerId]);

    const planetsBefore = await pool.query(
      'SELECT COUNT(*)::int as cnt FROM planets WHERE sector_id = $1 AND universe_id = $2',
      [targetSector, universeId],
    );

    player.sendMsg({ type: 'useTerraformDevice' });
    const msg = await player.waitForMessage('terraformResult');
    assert.equal(msg.success, true, 'terraform should succeed');
    assert.ok(msg.planet, 'should include planet info');
    assert.ok(msg.planet.id, 'planet should have id');
    assert.ok(msg.planet.name, 'planet should have name');
    assert.ok(msg.planet.type, 'planet should have type');
    assert.ok('sectorId' in msg.planet || 'sector_id' in msg.planet, 'planet should have sectorId');

    const planetsAfter = await pool.query(
      'SELECT COUNT(*)::int as cnt FROM planets WHERE sector_id = $1 AND universe_id = $2',
      [targetSector, universeId],
    );
    assert.equal(planetsAfter.rows[0].cnt, planetsBefore.rows[0].cnt + 1, 'should have one more planet');

    // Terraform device should be consumed
    const shipRes = await pool.query('SELECT terraform_devices FROM player_ships WHERE player_id = $1', [player.playerId]);
    assert.equal(shipRes.rows[0].terraform_devices, 0, 'device should be consumed');
  });
});

// ==================== WS: stardock and hardware store ====================

describe('WS: stardock and hardware store', () => {
  let universeId;
  let player;
  let stardockSector;

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'WsStardock', sectors: 20, seed: 70006,
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;

    // Find the stardock sector
    const sdRes = await pool.query(
      "SELECT id FROM sectors WHERE name = 'Stardock' AND universe_id = $1",
      [universeId],
    );
    assert.ok(sdRes.rows.length > 0, 'Stardock sector should exist');
    stardockSector = sdRes.rows[0].id;

    player = await createTestPlayer(universeId);

    // Navigate to stardock
    player.sendMsg({ type: 'path', from: 1, to: stardockSector });
    const pathMsg = await player.waitForMessage('pathResult');
    for (const sector of pathMsg.path.slice(1)) {
      player.sendMsg({ type: 'move', sector });
      // Consume whatever comes back (sectorDisplay or fighterEncounter)
      await player.waitForMessage('sectorDisplay').catch(() => null);
    }
  });

  after(() => { player?.close(); });

  it('dockStardock at class 9 port responds with stardockMenu', async () => {
    player.sendMsg({ type: 'dockStardock' });
    const msg = await player.waitForMessage('stardockMenu');
    assert.ok(msg, 'should receive stardockMenu');
  });

  it('buyPlanetBusters with insufficient credits returns error', async () => {
    // Drain credits
    await pool.query('UPDATE ship_cargo SET credits = 0 WHERE player_id = $1', [player.playerId]);
    player.sendMsg({ type: 'buyPlanetBusters', quantity: 1 });
    const msg = await player.waitForMessage('error');
    assert.ok(msg.message, 'should have error message');
  });

  it('buyPlanetBusters with sufficient credits succeeds', async () => {
    // Give credits and ensure ship can carry busters
    await pool.query('UPDATE ship_cargo SET credits = 100000 WHERE player_id = $1', [player.playerId]);
    // Check ship max
    const shipRes = await pool.query('SELECT ship_name FROM player_ships WHERE player_id = $1', [player.playerId]);
    const shipConfig = JSON.parse(readFileSync(join(CONFIG_SHIPS_DIR, '..', '..', 'config', 'ships', 'merchant.json'), 'utf8'));

    // If merchant freighter can't carry busters, give them a different ship
    if (shipConfig.maxPlanetBusters === 0) {
      const allConfigs = readdirSync(CONFIG_SHIPS_DIR).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(CONFIG_SHIPS_DIR, f), 'utf8')));
      const busterShip = allConfigs.find(c => c.maxPlanetBusters > 0);
      assert.ok(busterShip, 'at least one ship config must have maxPlanetBusters > 0');
      await pool.query('UPDATE player_ships SET ship_name = $1 WHERE player_id = $2', [busterShip.name, player.playerId]);
    }

    player.sendMsg({ type: 'buyPlanetBusters', quantity: 1 });
    const msg = await player.waitForMessage('buyHardwareResult');
    assert.ok(msg, 'should receive buyHardwareResult');
    assert.equal(msg.item, 'planet_busters');
    assert.equal(msg.quantity, 1);
    assert.ok('totalOnShip' in msg, 'should include totalOnShip');
    assert.ok('credits' in msg, 'should include remaining credits');
  });

  it('buyTerraformDevices succeeds', async () => {
    await pool.query('UPDATE ship_cargo SET credits = 100000 WHERE player_id = $1', [player.playerId]);
    // Ensure ship supports terraform devices (previous test may have switched to a buster-only ship)
    const allConfigs = readdirSync(CONFIG_SHIPS_DIR).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(CONFIG_SHIPS_DIR, f), 'utf8')));
    const terraShip = allConfigs.find(c => c.maxTerraformDevices > 0);
    assert.ok(terraShip, 'at least one ship config must have maxTerraformDevices > 0');
    await pool.query('UPDATE player_ships SET ship_name = $1 WHERE player_id = $2', [terraShip.name, player.playerId]);
    player.sendMsg({ type: 'buyTerraformDevices', quantity: 1 });
    const msg = await player.waitForMessage('buyHardwareResult');
    assert.ok(msg, 'should receive buyHardwareResult');
    assert.equal(msg.item, 'terraform_devices');
    assert.equal(msg.quantity, 1);
  });

  it('leaveStardock responds with sectorDisplay', async () => {
    player.sendMsg({ type: 'leaveStardock' });
    const msg = await player.waitForMessage('sectorDisplay');
    assert.ok(msg, 'should receive sectorDisplay after leaving stardock');
  });
});

// ==================== WS: destroy planet ====================

describe('WS: destroy planet', () => {
  let universeId;
  let player;

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'WsDestroy', sectors: 20, seed: 70007,
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;
    player = await createTestPlayer(universeId);
  });

  after(() => { player?.close(); });

  it('destroyPlanet without being on a planet returns error', async () => {
    player.sendMsg({ type: 'destroyPlanet' });
    const msg = await player.waitForMessage('error');
    assert.ok(msg.message, 'should have error message');
  });

  it('destroyPlanet without planet busters returns error', async () => {
    // Land on Earth first
    const planets = await pool.query(
      "SELECT id FROM planets WHERE universe_id = $1 AND name = 'Earth'", [universeId],
    );
    const earthId = planets.rows[0].id;
    player.sendMsg({ type: 'landOnPlanet', planetId: earthId });
    await player.waitForMessage('planetDisplayResult');

    // Make sure no planet busters
    await pool.query('UPDATE player_ships SET planet_busters = 0 WHERE player_id = $1', [player.playerId]);

    player.sendMsg({ type: 'destroyPlanet' });
    const msg = await player.waitForMessage('error');
    assert.ok(msg.message, 'should have error message about no busters');
  });

  it('destroyPlanet with busters destroys the planet', async () => {
    // Create a disposable planet to destroy
    const sectorRes = await pool.query(
      "SELECT w.sector_to FROM warps w JOIN sectors s ON s.id = w.sector_to AND s.universe_id = w.universe_id WHERE w.sector_from = 1 AND w.universe_id = $1 AND s.name != 'Stardock' LIMIT 1",
      [universeId],
    );
    const targetSector = sectorRes.rows[0].sector_to;

    // Insert a test planet
    const maxId = await pool.query('SELECT COALESCE(MAX(id), 0)::int as m FROM planets WHERE universe_id = $1', [universeId]);
    const newPlanetId = maxId.rows[0].m + 1;
    await pool.query(
      "INSERT INTO planets (id, sector_id, universe_id, name, type) VALUES ($1, $2, $3, 'Doomed', 'Barren')",
      [newPlanetId, targetSector, universeId],
    );

    // Move to that sector
    player.sendMsg({ type: 'leavePlanet' });
    await player.waitForMessage('sectorDisplay').catch(() => null);

    player.sendMsg({ type: 'path', from: 1, to: targetSector });
    const pathMsg = await player.waitForMessage('pathResult');
    for (const sector of pathMsg.path.slice(1)) {
      player.sendMsg({ type: 'move', sector });
      await player.waitForMessage('sectorDisplay');
    }

    // Land on the doomed planet
    player.sendMsg({ type: 'landOnPlanet', planetId: newPlanetId });
    await player.waitForMessage('planetDisplayResult');

    // Give planet buster
    await pool.query('UPDATE player_ships SET planet_busters = 1 WHERE player_id = $1', [player.playerId]);

    player.sendMsg({ type: 'destroyPlanet' });
    const msg = await player.waitForMessage('destroyPlanetResult');
    assert.equal(msg.destroyed, true);
    assert.equal(msg.planetId, newPlanetId);
    assert.ok('planetName' in msg, 'destroyPlanetResult should include planetName');
    assert.equal(msg.planetName, 'Doomed', 'planetName should match the destroyed planet');

    // Verify planet is gone from DB
    const check = await pool.query('SELECT COUNT(*)::int as cnt FROM planets WHERE id = $1 AND universe_id = $2', [newPlanetId, universeId]);
    assert.equal(check.rows[0].cnt, 0, 'planet should be deleted from DB');

    // Verify planet buster was consumed
    const shipRes = await pool.query('SELECT planet_busters FROM player_ships WHERE player_id = $1', [player.playerId]);
    assert.equal(shipRes.rows[0].planet_busters, 0, 'planet buster should be consumed');

    // Should also receive a sectorDisplay after destruction
    const sectorMsg = await player.waitForMessage('sectorDisplay');
    assert.ok(sectorMsg, 'should receive sectorDisplay after planet destruction');
  });
});

// ==================== WS: landOnPlanet wrong sector ====================

describe('WS: landOnPlanet validation', () => {
  let universeId;
  let player;

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'WsLandValidation', sectors: 20, seed: 70008,
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;
    player = await createTestPlayer(universeId);
  });

  after(() => { player?.close(); });

  it('landOnPlanet with planet in a different sector returns error', async () => {
    // Insert a planet in a sector the player is NOT in
    const warps = await pool.query(
      'SELECT sector_to FROM warps WHERE sector_from = 1 AND universe_id = $1 LIMIT 1',
      [universeId],
    );
    const otherSector = warps.rows[0].sector_to;
    const maxId = await pool.query('SELECT COALESCE(MAX(id), 0)::int as m FROM planets WHERE universe_id = $1', [universeId]);
    const planetId = maxId.rows[0].m + 1;
    await pool.query(
      "INSERT INTO planets (id, sector_id, universe_id, name, type) VALUES ($1, $2, $3, 'FarPlanet', 'Barren')",
      [planetId, otherSector, universeId],
    );

    // Player is in sector 1, try to land on planet in otherSector
    player.sendMsg({ type: 'landOnPlanet', planetId });
    const msg = await player.waitForMessage('error');
    assert.ok(msg.message, 'should receive error for planet not in current sector');

    // cleanup
    await pool.query('DELETE FROM planets WHERE id = $1 AND universe_id = $2', [planetId, universeId]);
  });
});

// ==================== WS: buy hardware exceeds max ====================

describe('WS: buy hardware exceeds ship maximum', () => {
  let universeId;
  let player;
  let stardockSector;

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'WsHardwareMax', sectors: 20, seed: 70009,
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;

    const sdRes = await pool.query(
      "SELECT id FROM sectors WHERE name = 'Stardock' AND universe_id = $1",
      [universeId],
    );
    stardockSector = sdRes.rows[0].id;

    player = await createTestPlayer(universeId);

    // Navigate to stardock
    player.sendMsg({ type: 'path', from: 1, to: stardockSector });
    const pathMsg = await player.waitForMessage('pathResult');
    for (const sector of pathMsg.path.slice(1)) {
      player.sendMsg({ type: 'move', sector });
      await player.waitForMessage('sectorDisplay').catch(() => null);
    }

    // Dock at stardock
    player.sendMsg({ type: 'dockStardock' });
    await player.waitForMessage('stardockMenu');
  });

  after(() => { player?.close(); });

  it('buyPlanetBusters exceeding ship max returns error', async () => {
    await pool.query('UPDATE ship_cargo SET credits = 10000000 WHERE player_id = $1', [player.playerId]);

    // Find ship max
    const shipRes = await pool.query('SELECT ship_name FROM player_ships WHERE player_id = $1', [player.playerId]);
    const allConfigs = readdirSync(CONFIG_SHIPS_DIR).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(CONFIG_SHIPS_DIR, f), 'utf8')));
    const shipConfig = allConfigs.find(c => c.name === shipRes.rows[0].ship_name);

    // Try buying more than max
    const overMax = (shipConfig?.maxPlanetBusters || 0) + 10;
    player.sendMsg({ type: 'buyPlanetBusters', quantity: overMax });
    const msg = await player.waitForMessage('error');
    assert.ok(msg.message, 'should return error when exceeding max planet busters');
  });

  it('buyPlanetBusters exceeding ship max cumulatively returns error', async () => {
    await pool.query('UPDATE ship_cargo SET credits = 10000000 WHERE player_id = $1', [player.playerId]);

    const shipRes = await pool.query('SELECT ship_name FROM player_ships WHERE player_id = $1', [player.playerId]);
    const allConfigs = readdirSync(CONFIG_SHIPS_DIR).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(CONFIG_SHIPS_DIR, f), 'utf8')));
    const busterShip = allConfigs.find(c => c.maxPlanetBusters >= 2);
    if (busterShip) {
      // Set current inventory to max - 1
      await pool.query('UPDATE player_ships SET ship_name = $1, planet_busters = $2 WHERE player_id = $3',
        [busterShip.name, busterShip.maxPlanetBusters - 1, player.playerId]);

      // Try buying 2 more, which should exceed max
      player.sendMsg({ type: 'buyPlanetBusters', quantity: 2 });
      const msg = await player.waitForMessage('error');
      assert.ok(msg.message, 'should return error when cumulative total exceeds max');
    }
  });

  it('buyTerraformDevices exceeding ship max returns error', async () => {
    await pool.query('UPDATE ship_cargo SET credits = 10000000 WHERE player_id = $1', [player.playerId]);

    const shipRes = await pool.query('SELECT ship_name FROM player_ships WHERE player_id = $1', [player.playerId]);
    const allConfigs = readdirSync(CONFIG_SHIPS_DIR).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(CONFIG_SHIPS_DIR, f), 'utf8')));
    const shipConfig = allConfigs.find(c => c.name === shipRes.rows[0].ship_name);

    const overMax = (shipConfig?.maxTerraformDevices || 0) + 10;
    player.sendMsg({ type: 'buyTerraformDevices', quantity: overMax });
    const msg = await player.waitForMessage('error');
    assert.ok(msg.message, 'should return error when exceeding max terraform devices');
  });

  it('dockStardock in non-class-9 sector returns error', async () => {
    // Leave stardock first
    player.sendMsg({ type: 'leaveStardock' });
    await player.waitForMessage('sectorDisplay').catch(() => null);

    // Move to sector 1 (which has class 0 port, not class 9)
    player.sendMsg({ type: 'path', from: stardockSector, to: 1 });
    const pathMsg = await player.waitForMessage('pathResult');
    for (const sector of pathMsg.path.slice(1)) {
      player.sendMsg({ type: 'move', sector });
      await player.waitForMessage('sectorDisplay').catch(() => null);
    }

    player.sendMsg({ type: 'dockStardock' });
    const msg = await player.waitForMessage('error');
    assert.ok(msg.message, 'should return error for dockStardock in non-class-9 sector');
  });
});

// ==================== WS: buy hardware requires dockStardock (not just being in sector) ====================

describe('WS: buy hardware requires stardock docking', () => {
  let universeId;
  let player;
  let stardockSector;

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'WsStardockFlag', sectors: 20, seed: 70015,
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;

    const sdRes = await pool.query(
      "SELECT id FROM sectors WHERE name = 'Stardock' AND universe_id = $1",
      [universeId],
    );
    stardockSector = sdRes.rows[0].id;

    player = await createTestPlayer(universeId);

    // Navigate to stardock sector but do NOT call dockStardock
    player.sendMsg({ type: 'path', from: 1, to: stardockSector });
    const pathMsg = await player.waitForMessage('pathResult');
    for (const sector of pathMsg.path.slice(1)) {
      player.sendMsg({ type: 'move', sector });
      await player.waitForMessage('sectorDisplay').catch(() => null);
    }

    // Give credits and a ship that can carry busters
    await pool.query('UPDATE ship_cargo SET credits = 100000 WHERE player_id = $1', [player.playerId]);
    const allConfigs = readdirSync(CONFIG_SHIPS_DIR).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(CONFIG_SHIPS_DIR, f), 'utf8')));
    const busterShip = allConfigs.find(c => c.maxPlanetBusters > 0);
    if (busterShip) {
      await pool.query('UPDATE player_ships SET ship_name = $1 WHERE player_id = $2', [busterShip.name, player.playerId]);
    }
  });

  after(() => { player?.close(); });

  it('buyPlanetBusters in stardock sector without docking returns error', async () => {
    player.sendMsg({ type: 'buyPlanetBusters', quantity: 1 });
    const msg = await player.waitForMessage('error');
    assert.ok(msg.message, 'should return error when not docked at stardock');
  });

  it('buyTerraformDevices in stardock sector without docking returns error', async () => {
    const allConfigs = readdirSync(CONFIG_SHIPS_DIR).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(CONFIG_SHIPS_DIR, f), 'utf8')));
    const terraShip = allConfigs.find(c => c.maxTerraformDevices > 0);
    if (terraShip) {
      await pool.query('UPDATE player_ships SET ship_name = $1 WHERE player_id = $2', [terraShip.name, player.playerId]);
    }
    player.sendMsg({ type: 'buyTerraformDevices', quantity: 1 });
    const msg = await player.waitForMessage('error');
    assert.ok(msg.message, 'should return error when not docked at stardock');
  });
});

// ==================== WS: buy hardware credit deduction ====================

describe('WS: buy hardware credit deduction', () => {
  let universeId;
  let player;
  let stardockSector;

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'WsCreditDeduct', sectors: 20, seed: 70010,
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;

    const sdRes = await pool.query(
      "SELECT id FROM sectors WHERE name = 'Stardock' AND universe_id = $1",
      [universeId],
    );
    stardockSector = sdRes.rows[0].id;

    player = await createTestPlayer(universeId);

    const allConfigs = readdirSync(CONFIG_SHIPS_DIR).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(CONFIG_SHIPS_DIR, f), 'utf8')));

    // Navigate to stardock
    player.sendMsg({ type: 'path', from: 1, to: stardockSector });
    const pathMsg = await player.waitForMessage('pathResult');
    for (const sector of pathMsg.path.slice(1)) {
      player.sendMsg({ type: 'move', sector });
      await player.waitForMessage('sectorDisplay').catch(() => null);
    }

    player.sendMsg({ type: 'dockStardock' });
    await player.waitForMessage('stardockMenu');
  });

  after(() => { player?.close(); });

  it('buyPlanetBusters deducts 20000 credits per buster', async () => {
    // Find a ship that can carry planet busters
    const allConfigs = readdirSync(CONFIG_SHIPS_DIR).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(CONFIG_SHIPS_DIR, f), 'utf8')));
    const busterShip = allConfigs.find(c => c.maxPlanetBusters >= 2);
    assert.ok(busterShip, 'need at least one ship config with maxPlanetBusters >= 2');
    await pool.query('UPDATE player_ships SET ship_name = $1, planet_busters = 0 WHERE player_id = $2', [busterShip.name, player.playerId]);
    await pool.query('UPDATE ship_cargo SET credits = 100000 WHERE player_id = $1', [player.playerId]);

    player.sendMsg({ type: 'buyPlanetBusters', quantity: 2 });
    const msg = await player.waitForMessage('buyHardwareResult');
    assert.equal(msg.item, 'planet_busters');
    assert.equal(msg.quantity, 2);
    assert.equal(msg.credits, 60000, 'should deduct 40000 (2 * 20000) from 100000');
    assert.equal(msg.totalOnShip, 2);
  });

  it('buyTerraformDevices deducts 5000 credits per device', async () => {
    // Find a ship that can carry terraform devices
    const allConfigs = readdirSync(CONFIG_SHIPS_DIR).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(CONFIG_SHIPS_DIR, f), 'utf8')));
    const terraShip = allConfigs.find(c => c.maxTerraformDevices >= 2);
    assert.ok(terraShip, 'need at least one ship config with maxTerraformDevices >= 2');
    await pool.query('UPDATE player_ships SET ship_name = $1, terraform_devices = 0 WHERE player_id = $2', [terraShip.name, player.playerId]);
    await pool.query('UPDATE ship_cargo SET credits = 100000 WHERE player_id = $1', [player.playerId]);

    player.sendMsg({ type: 'buyTerraformDevices', quantity: 2 });
    const msg = await player.waitForMessage('buyHardwareResult');
    assert.equal(msg.item, 'terraform_devices');
    assert.equal(msg.quantity, 2);
    assert.equal(msg.credits, 90000, 'should deduct 10000 (2 * 5000) from 100000');
    assert.equal(msg.totalOnShip, 2);
  });

  it('buyPlanetBusters when not at stardock returns error', async () => {
    // Leave stardock
    player.sendMsg({ type: 'leaveStardock' });
    await player.waitForMessage('sectorDisplay').catch(() => null);

    player.sendMsg({ type: 'buyPlanetBusters', quantity: 1 });
    const msg = await player.waitForMessage('error');
    assert.ok(msg.message, 'should return error when not at stardock');
  });
});

// ==================== WS: terraform collision logic ====================

describe('WS: terraform collision logic', () => {
  let universeId;
  let player;
  let targetSector;

  before(async () => {
    // Create universe with max_planets_per_sector=1 and collision_likelihood=100
    // so we can deterministically test collision behavior
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'WsCollision', sectors: 20, seed: 70011, max_planets_per_sector: 1,
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;

    // Set collision likelihood to 100 so collisions always happen
    await pool.query(
      'UPDATE universes SET planet_collision_likelihood = 100, planet_collision_min_hours = 1, planet_collision_max_hours = 48 WHERE id = $1',
      [universeId],
    );

    player = await createTestPlayer(universeId);

    // Find a non-restricted sector with a warp from sector 1
    const warps = await pool.query(
      "SELECT w.sector_to FROM warps w JOIN sectors s ON s.id = w.sector_to AND s.universe_id = w.universe_id WHERE w.sector_from = 1 AND w.universe_id = $1 AND s.name != 'Stardock' LIMIT 1",
      [universeId],
    );
    assert.ok(warps.rows.length > 0, 'need a warp target');
    targetSector = warps.rows[0].sector_to;

    // Move to that sector
    player.sendMsg({ type: 'move', sector: targetSector });
    await player.waitForMessage('sectorDisplay');

    // Seed an existing planet in the sector so it already has 1 (which equals max)
    const maxId = await pool.query('SELECT COALESCE(MAX(id), 0)::int as m FROM planets WHERE universe_id = $1', [universeId]);
    await pool.query(
      "INSERT INTO planets (id, sector_id, universe_id, name, type) VALUES ($1, $2, $3, 'ExistingP', 'Terran')",
      [maxId.rows[0].m + 1, targetSector, universeId],
    );
  });

  after(() => { player?.close(); });

  it('terraformResult succeeds even when sector is at max capacity', async () => {
    // Sector already has 1 planet and max_planets_per_sector=1, so it's at capacity
    await pool.query('UPDATE player_ships SET terraform_devices = 1 WHERE player_id = $1', [player.playerId]);

    player.sendMsg({ type: 'useTerraformDevice' });
    const msg = await player.waitForMessage('terraformResult');
    assert.equal(msg.success, true, 'terraform should still succeed even at capacity');
    assert.ok('collision' in msg, 'terraformResult should include collision field');
  });

  it('terraform in sector at max capacity creates planet and collision row', async () => {
    // Give terraform device
    await pool.query('UPDATE player_ships SET terraform_devices = 1 WHERE player_id = $1', [player.playerId]);

    player.sendMsg({ type: 'useTerraformDevice' });
    const msg = await player.waitForMessage('terraformResult');
    assert.equal(msg.success, true, 'terraform should succeed');
    assert.ok(msg.planet, 'should include planet info');
    assert.ok(msg.planet.name, 'planet should have a name');
    assert.ok(msg.planet.type, 'planet should have a type');
    assert.ok('collision' in msg, 'terraformResult should include collision boolean');
    assert.equal(msg.collision, true, 'collision should be true since likelihood is 100');

    // Verify a collision row exists in the DB for this specific planet
    const collisionRes = await pool.query(
      'SELECT collision_planet, colliding_with, collision_at FROM planet_collisions WHERE universe_id = $1 AND collision_planet = $2',
      [universeId, msg.planet.id],
    );
    assert.ok(collisionRes.rows.length >= 1, 'should have a collision row for the new planet');
    const collision = collisionRes.rows[0];
    assert.equal(collision.collision_planet, msg.planet.id, 'collision_planet should be the new planet');

    // Verify colliding_with is a planet in the same sector
    const collidingPlanet = await pool.query(
      'SELECT sector_id FROM planets WHERE id = $1 AND universe_id = $2',
      [collision.colliding_with, universeId],
    );
    assert.ok(collidingPlanet.rows.length > 0, 'colliding_with should reference an existing planet');
    assert.equal(collidingPlanet.rows[0].sector_id, targetSector, 'colliding_with planet should be in the same sector');

    // Verify collision_at is between NOW+min_hours and NOW+max_hours
    const collisionAt = new Date(collision.collision_at);
    const now = new Date();
    const minTime = new Date(now.getTime() + 1 * 60 * 60 * 1000 - 60000); // min_hours=1, minus 1 min tolerance
    const maxTime = new Date(now.getTime() + 48 * 60 * 60 * 1000 + 60000); // max_hours=48, plus 1 min tolerance
    assert.ok(collisionAt >= minTime, `collision_at ${collisionAt.toISOString()} should be >= ${minTime.toISOString()}`);
    assert.ok(collisionAt <= maxTime, `collision_at ${collisionAt.toISOString()} should be <= ${maxTime.toISOString()}`);
  });

  it('terraformResult includes remaining terraformDevices count', async () => {
    // Give 2 devices, use 1
    await pool.query('UPDATE player_ships SET terraform_devices = 2 WHERE player_id = $1', [player.playerId]);

    player.sendMsg({ type: 'useTerraformDevice' });
    const msg = await player.waitForMessage('terraformResult');
    assert.equal(msg.success, true);
    assert.ok('terraformDevices' in msg, 'should include terraformDevices remaining count');
    assert.equal(msg.terraformDevices, 1, 'should have 1 remaining after using 1 of 2');
  });
});

// ==================== WS: terraform in Stardock sector ====================

describe('WS: terraform in Stardock sector returns restricted_sector', () => {
  let universeId;
  let player;
  let stardockSector;

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'WsTerraformSD', sectors: 20, seed: 80001,
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;

    const sdRes = await pool.query(
      "SELECT id FROM sectors WHERE name = 'Stardock' AND universe_id = $1",
      [universeId],
    );
    assert.ok(sdRes.rows.length > 0, 'Stardock sector should exist');
    stardockSector = sdRes.rows[0].id;

    player = await createTestPlayer(universeId);

    // Navigate to stardock sector
    player.sendMsg({ type: 'path', from: 1, to: stardockSector });
    const pathMsg = await player.waitForMessage('pathResult');
    for (const sector of pathMsg.path.slice(1)) {
      player.sendMsg({ type: 'move', sector });
      await player.waitForMessage('sectorDisplay').catch(() => null);
    }

    // Give the player a terraform device
    await pool.query('UPDATE player_ships SET terraform_devices = 1 WHERE player_id = $1', [player.playerId]);
  });

  after(() => { player?.close(); });

  it('useTerraformDevice in Stardock sector returns restricted_sector', async () => {
    player.sendMsg({ type: 'useTerraformDevice' });
    const msg = await player.waitForMessage('terraformResult');
    assert.equal(msg.success, false);
    assert.equal(msg.reason, 'restricted_sector');

    // Device should not be consumed
    const shipRes = await pool.query('SELECT terraform_devices FROM player_ships WHERE player_id = $1', [player.playerId]);
    assert.equal(shipRes.rows[0].terraform_devices, 1, 'device should not be consumed on restricted sector');
  });
});

// ==================== WS: on_planet_id cleared after destroy ====================

describe('WS: on_planet_id cleared after destroyPlanet', () => {
  let universeId;
  let player;

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'WsDestroyClears', sectors: 20, seed: 80002,
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;
    player = await createTestPlayer(universeId);
  });

  after(() => { player?.close(); });

  it('on_planet_id is NULL after destroying a planet', async () => {
    // Find a non-restricted sector to create a disposable planet
    const warps = await pool.query(
      "SELECT w.sector_to FROM warps w JOIN sectors s ON s.id = w.sector_to AND s.universe_id = w.universe_id WHERE w.sector_from = 1 AND w.universe_id = $1 AND s.name != 'Stardock' LIMIT 1",
      [universeId],
    );
    const targetSector = warps.rows[0].sector_to;

    // Insert a disposable planet
    const maxId = await pool.query('SELECT COALESCE(MAX(id), 0)::int as m FROM planets WHERE universe_id = $1', [universeId]);
    const newPlanetId = maxId.rows[0].m + 1;
    await pool.query(
      "INSERT INTO planets (id, sector_id, universe_id, name, type) VALUES ($1, $2, $3, 'DestroyMe', 'Barren')",
      [newPlanetId, targetSector, universeId],
    );

    // Move to that sector
    player.sendMsg({ type: 'path', from: 1, to: targetSector });
    const pathMsg = await player.waitForMessage('pathResult');
    for (const sector of pathMsg.path.slice(1)) {
      player.sendMsg({ type: 'move', sector });
      await player.waitForMessage('sectorDisplay');
    }

    // Land on the planet
    player.sendMsg({ type: 'landOnPlanet', planetId: newPlanetId });
    await player.waitForMessage('planetDisplayResult');

    // Verify on_planet_id is set
    const beforeRes = await pool.query('SELECT on_planet_id FROM players WHERE id = $1', [player.playerId]);
    assert.equal(beforeRes.rows[0].on_planet_id, newPlanetId, 'on_planet_id should be set before destroy');

    // Give planet buster and destroy
    await pool.query('UPDATE player_ships SET planet_busters = 1 WHERE player_id = $1', [player.playerId]);
    player.sendMsg({ type: 'destroyPlanet' });
    await player.waitForMessage('destroyPlanetResult');
    await player.waitForMessage('sectorDisplay');

    // Verify on_planet_id is cleared
    const afterRes = await pool.query('SELECT on_planet_id FROM players WHERE id = $1', [player.playerId]);
    assert.equal(afterRes.rows[0].on_planet_id, null, 'on_planet_id should be NULL after destroying planet');
  });
});

// ==================== WS: terraform success includes collision field and terraformDevices ====================

describe('WS: terraform success response completeness', () => {
  let universeId;
  let player;

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'WsTerraformFull', sectors: 20, seed: 80003,
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;
    player = await createTestPlayer(universeId);
  });

  after(() => { player?.close(); });

  it('terraformResult includes collision=false and terraformDevices when sector is below capacity', async () => {
    // Move to a non-restricted sector with no planets
    const warps = await pool.query(
      "SELECT w.sector_to FROM warps w JOIN sectors s ON s.id = w.sector_to AND s.universe_id = w.universe_id WHERE w.sector_from = 1 AND w.universe_id = $1 AND s.name != 'Stardock' LIMIT 1",
      [universeId],
    );
    const targetSector = warps.rows[0].sector_to;

    // Remove any existing planets from that sector
    await pool.query('DELETE FROM planets WHERE sector_id = $1 AND universe_id = $2', [targetSector, universeId]);

    player.sendMsg({ type: 'move', sector: targetSector });
    await player.waitForMessage('sectorDisplay');

    // Give 2 terraform devices
    await pool.query('UPDATE player_ships SET terraform_devices = 2 WHERE player_id = $1', [player.playerId]);

    player.sendMsg({ type: 'useTerraformDevice' });
    const msg = await player.waitForMessage('terraformResult');
    assert.equal(msg.success, true);
    assert.ok('collision' in msg, 'terraformResult should include collision field');
    assert.equal(msg.collision, false, 'collision should be false when sector is below max capacity');
    assert.ok('terraformDevices' in msg, 'terraformResult should include terraformDevices count');
    assert.equal(msg.terraformDevices, 1, 'should have 1 remaining after using 1 of 2');
  });
});

// ==================== WS: buyTerraformDevices when not at stardock ====================

describe('WS: buyTerraformDevices when not at stardock', () => {
  let universeId;
  let player;

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'WsTerraNotSD', sectors: 20, seed: 80004,
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;
    player = await createTestPlayer(universeId);
  });

  after(() => { player?.close(); });

  it('buyTerraformDevices when not at stardock returns error', async () => {
    player.sendMsg({ type: 'buyTerraformDevices', quantity: 1 });
    const msg = await player.waitForMessage('error');
    assert.ok(msg.message, 'should return error when not at stardock');
  });
});

// ==================== WS: terraform planet ID sequencing ====================

describe('WS: terraform planet ID sequencing', () => {
  let universeId;
  let player;

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'WsTerraSeq', sectors: 20, seed: 80005,
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;
    player = await createTestPlayer(universeId);
  });

  after(() => { player?.close(); });

  it('terraform-created planets get sequential IDs (MAX+1)', async () => {
    // Get current max planet ID in this universe
    const maxBefore = await pool.query('SELECT COALESCE(MAX(id), 0)::int as m FROM planets WHERE universe_id = $1', [universeId]);
    const expectedFirstId = maxBefore.rows[0].m + 1;

    // Move to a non-restricted sector
    const warps = await pool.query(
      "SELECT w.sector_to FROM warps w JOIN sectors s ON s.id = w.sector_to AND s.universe_id = w.universe_id WHERE w.sector_from = 1 AND w.universe_id = $1 AND s.name != 'Stardock' LIMIT 1",
      [universeId],
    );
    const targetSector = warps.rows[0].sector_to;
    player.sendMsg({ type: 'move', sector: targetSector });
    await player.waitForMessage('sectorDisplay');

    // Give 2 terraform devices
    await pool.query('UPDATE player_ships SET terraform_devices = 2 WHERE player_id = $1', [player.playerId]);

    // Create first planet
    player.sendMsg({ type: 'useTerraformDevice' });
    const msg1 = await player.waitForMessage('terraformResult');
    assert.equal(msg1.success, true);
    assert.equal(msg1.planet.id, expectedFirstId, `first terraform planet should have id=${expectedFirstId}`);

    // Create second planet
    player.sendMsg({ type: 'useTerraformDevice' });
    const msg2 = await player.waitForMessage('terraformResult');
    assert.equal(msg2.success, true);
    assert.equal(msg2.planet.id, expectedFirstId + 1, `second terraform planet should have id=${expectedFirstId + 1}`);
  });
});

// ==================== players.on_planet_id default NULL ====================

describe('players on_planet_id default', () => {
  it('on_planet_id defaults to NULL for new players', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'WsOnPlanetDef', sectors: 20, seed: 80006,
    });
    assert.equal(res.status, 201);
    const universeId = res.body.id;
    const player = await createTestPlayer(universeId);

    const dbRes = await pool.query('SELECT on_planet_id FROM players WHERE id = $1', [player.playerId]);
    assert.equal(dbRes.rows[0].on_planet_id, null, 'on_planet_id should default to NULL for new player');

    player.close();
  });
});

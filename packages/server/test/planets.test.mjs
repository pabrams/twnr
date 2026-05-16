import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { ensureServer, createPool, ADMIN_API_KEY, BASE, WS_BASE } from './global-setup.mjs';
import { createTestUser, createTestPlayer as createTestPlayerDB } from './helpers.mjs';
import { ClientMsgType, ServerMsgType } from '@twnr/shared';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = join(dirname(__filename), '..');

const CONFIG_SHIPS_DIR = join(PROJECT_ROOT, 'config', 'ships');

async function adminKeyPost(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': ADMIN_API_KEY },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}


// Create a test user in DB, create a player, and connect via WebSocket.
// Returns { ws, playerId, token, close() }.
async function createTestPlayer(universeId) {

  // Create user and player directly in DB (bypasses rate limiting)
  const { token } = await createTestUser(pool);

  // Connect WebSocket
  const ws = new WebSocket(`${WS_BASE}/ws?universe=${universeId}`, {
    headers: { Cookie: `twnr_auth=${token}` },
  });

  const messages = [];
  const waiters = [];

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WS connect timeout')), 2000);
    ws.on('open', () => { clearTimeout(timeout); resolve(); });
    ws.on('error', (err) => { clearTimeout(timeout); reject(err); });
  });

  ws.on('message', (data) => {
    const raw = JSON.parse(data.toString());
    const msg = raw.payload ?? raw;
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

  // Navigate to a sector, handling drone encounters along the way
  async function navigateTo(targetSector, fromSector) {
    sendMsg({ type: ClientMsgType.ShortestPath, from: fromSector, to: targetSector });
    const pathMsg = await waitForMessage(ServerMsgType.ShortestPathResult);
    for (const step of pathMsg.path.slice(1)) {
      sendMsg({ type: ClientMsgType.Move, sector: step.sector });
      // Drain messages until we get moveResult success, handling drone encounters
      let moved = false;
      for (let attempt = 0; attempt < 5 && !moved; attempt++) {
        try {
          const msg = await waitForAny(3000);
          if (msg.type === ServerMsgType.MoveResult && msg.outcome === 'success') {
            moved = true;
          } else if (msg.type === ServerMsgType.MoveResult && msg.outcome === 'encounter') {
            // Retreat from drones
            sendMsg({ type: ClientMsgType.RetreatFromDrones });
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
  const welcome = await waitForMessage(ServerMsgType.Welcome);

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

  it('id is SERIAL (has nextval sequence)', () => {
    assert.ok(cols.id, 'id column missing');
    const def = cols.id.column_default || '';
    assert.ok(def.includes('nextval'), `id should use a sequence (SERIAL), got default: ${def}`);
  });

  it('primary key is (id)', async () => {
    const pk = await getPKColumns('planets');
    assert.deepStrictEqual(pk, new Set(['id']));
  });

  it('universe_id column does not exist', () => {
    assert.ok(!cols.universe_id, 'universe_id column should not exist on planets');
  });

  it('colonists column is removed', () => {
    assert.ok(!cols.colonists, 'colonists column should be removed');
  });

  it('has SMALLINT column drones; INTEGER columns: fuel, organics, equipment, colonists_fuel, colonists_organics, colonists_equipment', () => {
    const smallintCols = ['drones'];
    // fuel/organics/equipment widened to INTEGER alongside the colonists_*
    // columns so per-commodity caps from planet_types (up to 1,000,000)
    // can be honoured without overflowing 32K.
    const integerCols = [
      'fuel', 'organics', 'equipment',
      'colonists_fuel', 'colonists_organics', 'colonists_equipment',
    ];
    for (const name of smallintCols) {
      assert.ok(cols[name], `column ${name} missing`);
      assert.ok(cols[name].data_type.includes('smallint'), `${name} should be smallint, got ${cols[name].data_type}`);
      assert.equal(cols[name].is_nullable, 'NO', `${name} should be NOT NULL`);
    }
    for (const name of integerCols) {
      assert.ok(cols[name], `column ${name} missing`);
      assert.ok(cols[name].data_type.includes('integer'), `${name} should be integer, got ${cols[name].data_type}`);
      assert.equal(cols[name].is_nullable, 'NO', `${name} should be NOT NULL`);
    }
  });

  it('new SMALLINT columns default to 0', () => {
    const expected = ['drones', 'fuel', 'organics', 'equipment', 'colonists_fuel', 'colonists_organics', 'colonists_equipment'];
    for (const name of expected) {
      assert.ok(cols[name].column_default !== null, `${name} should have a default`);
      assert.ok(cols[name].column_default.includes('0'), `${name} default should be 0, got ${cols[name].column_default}`);
    }
  });
});

// ==================== planets triggers ====================

describe('planets triggers', () => {
  let univId;

  let sectorDbId;
  before(async () => {
    const res = await pool.query("INSERT INTO universes (name, seed) VALUES ('trigger_test', 1) RETURNING id");
    univId = res.rows[0].id;
    const sRes = await pool.query('INSERT INTO sectors (universe_id, sector_number, name) VALUES ($1, 1, $2) RETURNING id', [univId, 'S1']);
    sectorDbId = sRes.rows[0].id;
  });

  after(async () => {
    await pool.query('DELETE FROM planets WHERE sector_id IN (SELECT id FROM sectors WHERE universe_id = $1)', [univId]);
    await pool.query('DELETE FROM sectors WHERE universe_id = $1', [univId]);
    await pool.query('DELETE FROM universes WHERE id = $1', [univId]);
  });

  it('sets created_at on INSERT', async () => {
    const ins = await pool.query(
      "INSERT INTO planets (sector_id, name, type) VALUES ($1, 'TriggerWorld', 'Terran') RETURNING id",
      [sectorDbId],
    );
    const planetId = ins.rows[0].id;
    const res = await pool.query('SELECT created_at FROM planets WHERE id = $1', [planetId]);
    assert.ok(res.rows[0].created_at, 'created_at should be set on insert');
  });

  it('sets updated_at on UPDATE', async () => {
    const existing = await pool.query('SELECT id FROM planets WHERE sector_id = $1 LIMIT 1', [sectorDbId]);
    const planetId = existing.rows[0].id;
    await new Promise(r => setTimeout(r, 100));
    await pool.query("UPDATE planets SET name = 'TriggerWorld2' WHERE id = $1", [planetId]);
    const res = await pool.query('SELECT updated_at, created_at FROM planets WHERE id = $1', [planetId]);
    assert.ok(res.rows[0].updated_at, 'updated_at should be set on update');
    assert.ok(res.rows[0].updated_at >= res.rows[0].created_at, 'updated_at should be >= created_at');
  });
});

// ==================== multiple planets per sector ====================

describe('multiple planets per sector', () => {
  it('allows inserting multiple planets in the same sector', async () => {
    const res = await pool.query("INSERT INTO universes (name, seed) VALUES ('multi_test', 2) RETURNING id");
    const uid = res.rows[0].id;
    const sRes = await pool.query('INSERT INTO sectors (universe_id, sector_number, name) VALUES ($1, 1, $2) RETURNING id', [uid, 'S1']);
    const secId = sRes.rows[0].id;
    await pool.query("INSERT INTO planets (sector_id, name, type) VALUES ($1, 'P1', 'Terran')", [secId]);
    await pool.query("INSERT INTO planets (sector_id, name, type) VALUES ($1, 'P2', 'Oceanic')", [secId]);
    const count = await pool.query('SELECT COUNT(*)::int as cnt FROM planets WHERE sector_id = $1', [secId]);
    assert.equal(count.rows[0].cnt, 2);

    await pool.query('DELETE FROM planets WHERE sector_id IN (SELECT id FROM sectors WHERE universe_id = $1)', [uid]);
    await pool.query('DELETE FROM sectors WHERE universe_id = $1', [uid]);
    await pool.query('DELETE FROM universes WHERE id = $1', [uid]);
  });
});

// ==================== universe_template table (planet settings) ====================

describe('universe_template table (planet settings)', () => {
  let cols;
  before(async () => { cols = await getColumns('universe_template'); });

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

  it('stock edit defaults are correct (2, 50, 24, 24)', async () => {
    const row = await pool.query(
      `SELECT max_planets_per_sector, planet_collision_likelihood,
              planet_collision_min_hours, planet_collision_max_hours
       FROM universe_template WHERE name = 'stock'`,
    );
    assert.equal(row.rows.length, 1, 'stock template must exist');
    const r = row.rows[0];
    assert.equal(r.max_planets_per_sector, 2);
    assert.equal(r.planet_collision_likelihood, 50);
    assert.equal(r.planet_collision_min_hours, 24);
    assert.equal(r.planet_collision_max_hours, 24);
  });
});

// ==================== planet_collisions table ====================

describe('planet_collisions table', () => {
  let cols;
  before(async () => { cols = await getColumns('planet_collisions'); });

  it('exists with required columns', () => {
    assert.ok(cols.collision_planet, 'collision_planet missing');
    assert.ok(cols.colliding_with, 'colliding_with missing');
    assert.ok(!cols.universe_id, 'universe_id should not exist on planet_collisions');
    assert.ok(cols.collision_at, 'collision_at missing');
    assert.ok(cols.collision_at.data_type.includes('timestamp'));
    assert.equal(cols.collision_at.is_nullable, 'NO');
  });

  it('primary key is (collision_planet, colliding_with)', async () => {
    const pk = await getPKColumns('planet_collisions');
    assert.deepStrictEqual(pk, new Set(['collision_planet', 'colliding_with']));
  });

  it('cascade deletes when collision_planet is deleted', async () => {
    const res = await pool.query("INSERT INTO universes (name, seed) VALUES ('cascade_test', 3) RETURNING id");
    const uid = res.rows[0].id;
    const s1Res = await pool.query('INSERT INTO sectors (universe_id, sector_number, name) VALUES ($1, 1, $2) RETURNING id', [uid, 'S1']);
    const s2Res = await pool.query('INSERT INTO sectors (universe_id, sector_number, name) VALUES ($1, 2, $2) RETURNING id', [uid, 'S2']);
    const sec1 = s1Res.rows[0].id, sec2 = s2Res.rows[0].id;
    const p1 = await pool.query("INSERT INTO planets (sector_id, name, type) VALUES ($1, 'P1', 'Terran') RETURNING id", [sec1]);
    const p2 = await pool.query("INSERT INTO planets (sector_id, name, type) VALUES ($1, 'P2', 'Oceanic') RETURNING id", [sec2]);
    const p1Id = p1.rows[0].id, p2Id = p2.rows[0].id;
    await pool.query(
      "INSERT INTO planet_collisions (collision_planet, colliding_with, collision_at) VALUES ($1, $2, NOW() + interval '24 hours')",
      [p1Id, p2Id],
    );
    const before = await pool.query('SELECT COUNT(*)::int as cnt FROM planet_collisions WHERE collision_planet = $1', [p1Id]);
    assert.equal(before.rows[0].cnt, 1);

    await pool.query('DELETE FROM planets WHERE id = $1', [p1Id]);
    const afterDel = await pool.query('SELECT COUNT(*)::int as cnt FROM planet_collisions WHERE collision_planet = $1', [p1Id]);
    assert.equal(afterDel.rows[0].cnt, 0, 'collision row should be deleted when collision_planet is deleted');

    await pool.query('DELETE FROM planets WHERE sector_id IN (SELECT id FROM sectors WHERE universe_id = $1)', [uid]);
    await pool.query('DELETE FROM sectors WHERE universe_id = $1', [uid]);
    await pool.query('DELETE FROM universes WHERE id = $1', [uid]);
  });

  it('cascade deletes when colliding_with planet is deleted', async () => {
    const res = await pool.query("INSERT INTO universes (name, seed) VALUES ('cascade2_test', 4) RETURNING id");
    const uid = res.rows[0].id;
    const sRes = await pool.query('INSERT INTO sectors (universe_id, sector_number, name) VALUES ($1, 1, $2) RETURNING id', [uid, 'S1']);
    const secId = sRes.rows[0].id;
    const pA = await pool.query("INSERT INTO planets (sector_id, name, type) VALUES ($1, 'PA', 'Terran') RETURNING id", [secId]);
    const pB = await pool.query("INSERT INTO planets (sector_id, name, type) VALUES ($1, 'PB', 'Oceanic') RETURNING id", [secId]);
    const pAId = pA.rows[0].id, pBId = pB.rows[0].id;
    await pool.query(
      "INSERT INTO planet_collisions (collision_planet, colliding_with, collision_at) VALUES ($1, $2, NOW() + interval '24 hours')",
      [pAId, pBId],
    );

    await pool.query('DELETE FROM planets WHERE id = $1', [pBId]);
    const afterDel = await pool.query('SELECT COUNT(*)::int as cnt FROM planet_collisions WHERE collision_planet = $1', [pAId]);
    assert.equal(afterDel.rows[0].cnt, 0, 'collision row should be deleted when colliding_with planet is deleted');

    await pool.query('DELETE FROM planets WHERE sector_id IN (SELECT id FROM sectors WHERE universe_id = $1)', [uid]);
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

// ==================== ships table ====================

describe('ships table', () => {
  let cols;
  before(async () => { cols = await getColumns('ships'); });

  it('does NOT have planet_busters column (moved to ship_hardware)', () => {
    assert.ok(!cols.planet_busters, 'planet_busters should be removed from ships');
  });

  it('does NOT have terraform_devices column (moved to ship_hardware)', () => {
    assert.ok(!cols.terraform_devices, 'terraform_devices should be removed from ships');
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

  it('Vulpeculan Cruiser has maxPlanetBusters=0 and maxTerraformDevices=5', () => {
    const cruiser = configs.find(c => c.data.name === 'Vulpeculan Cruiser');
    assert.ok(cruiser, 'Vulpeculan Cruiser config not found');
    assert.equal(cruiser.data.maxPlanetBusters, 0);
    assert.equal(cruiser.data.maxTerraformDevices, 5);
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
  it('GET /api/ships includes max_planet_busters and max_terraform_devices', async () => {
    const res = await fetch(`${BASE}/api/ships`);
    assert.equal(res.status, 200);
    const ships = await res.json();
    assert.ok(Array.isArray(ships), 'should return an array');
    assert.ok(ships.length > 0, 'should have at least one ship');
    for (const ship of ships) {
      assert.ok('hardware' in ship, `${ship.name} missing hardware map in API response`);
    }
  });
});

// ==================== Admin API: edit-based universe generation ====================

describe('admin API edit-based universe generation', () => {
  it('generated universe links to stock edit by default', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'EditDefault', sectors: 20, seed: 50001,
    });
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    const uid = res.body.id;
    const row = await pool.query(
      `SELECT us.max_planets_per_sector
       FROM universes u JOIN universe_settings us ON us.universe_id = u.id WHERE u.id = $1`, [uid],
    );
    assert.equal(row.rows.length, 1, 'universe should have a settings snapshot');
    assert.equal(row.rows[0].max_planets_per_sector, 2, 'stock template defaults max_planets_per_sector to 2');
  });

  it('generated universe with explicit edit_name=stock links correctly', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'EditExplicit', sectors: 20, seed: 50002, edit_name: 'stock',
    });
    assert.equal(res.status, 201);
    const uid = res.body.id;
    const row = await pool.query(
      `SELECT et.name, us.max_planets_per_sector
       FROM universes u
       JOIN universe_template et ON u.template_id = et.id
       JOIN universe_settings us ON us.universe_id = u.id
       WHERE u.id = $1`, [uid],
    );
    assert.equal(row.rows[0].name, 'stock');
    assert.equal(row.rows[0].max_planets_per_sector, 2);
  });

  it('generated universe with custom edit inherits its max_planets_per_sector', async () => {
    // Create a custom template with max_planets_per_sector=5.
    await pool.query(
      "INSERT INTO universe_template (name, max_planets_per_sector) VALUES ('custom_mpps', 5) " +
      "ON CONFLICT (name) DO UPDATE SET max_planets_per_sector = 5",
    );
    try {
      const res = await adminKeyPost('/api/admin/universes/generate', {
        name: 'EditCustom', sectors: 20, seed: 50003, edit_name: 'custom_mpps',
      });
      assert.equal(res.status, 201);
      const uid = res.body.id;
      const row = await pool.query(
        `SELECT us.max_planets_per_sector
         FROM universes u JOIN universe_settings us ON us.universe_id = u.id WHERE u.id = $1`, [uid],
      );
      assert.equal(row.rows[0].max_planets_per_sector, 5);
    } finally {
      await pool.query("DELETE FROM universe_template WHERE name = 'custom_mpps'");
    }
  });

  it('stock edit has correct planet collision defaults via join', async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'EditCollisionDefaults', sectors: 20, seed: 50004,
    });
    assert.equal(res.status, 201);
    const uid = res.body.id;
    const row = await pool.query(
      `SELECT us.planet_collision_likelihood, us.planet_collision_min_hours, us.planet_collision_max_hours
       FROM universes u JOIN universe_settings us ON us.universe_id = u.id WHERE u.id = $1`, [uid],
    );
    assert.equal(row.rows[0].planet_collision_likelihood, 50);
    assert.equal(row.rows[0].planet_collision_min_hours, 24);
    assert.equal(row.rows[0].planet_collision_max_hours, 24);
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
    player.sendMsg({ type: ClientMsgType.SectorDisplay });
    const msg = await player.waitForMessage(ServerMsgType.SectorDisplayResult);
    assert.ok('planets' in msg, 'sectorDisplay should include planets field');
    assert.ok(Array.isArray(msg.planets), 'planets should be an array');
  });

  it('sector 1 planets array contains Earth with id, name, type', async () => {
    // Player starts in sector 1 which has Earth
    player.sendMsg({ type: ClientMsgType.SectorDisplay });
    const msg = await player.waitForMessage(ServerMsgType.SectorDisplayResult);
    assert.ok(msg.planets.length >= 1, 'sector 1 should have at least Earth');
    const earth = msg.planets.find(p => p.name === 'Earth');
    assert.ok(earth, 'Earth should be in sector 1 planets');
    assert.ok('id' in earth, 'planet should have id');
    assert.ok('name' in earth, 'planet should have name');
    assert.ok('type' in earth, 'planet should have type');
    assert.ok(typeof earth.id === 'number', 'Earth should have a numeric id');
  });

  it('sector with no planets returns empty planets array', async () => {
    // Move to a sector that has no planets
    const warps = await pool.query(
      `SELECT s_to.sector_number AS sector_to, s_to.id AS sector_db_id
       FROM warps w
       JOIN sectors s_from ON w.from_sector_id = s_from.id
       JOIN sectors s_to ON w.to_sector_id = s_to.id
       WHERE s_from.sector_number = 1 AND s_from.universe_id = $1 LIMIT 1`,
      [universeId],
    );
    assert.ok(warps.rows.length > 0, 'need a warp target from sector 1');
    const targetSector = warps.rows[0].sector_to;
    const targetSectorDbId = warps.rows[0].sector_db_id;

    // Ensure no planets in that sector
    await pool.query('DELETE FROM planets WHERE sector_id = $1', [targetSectorDbId]);

    player.sendMsg({ type: ClientMsgType.Move, sector: targetSector });
    await player.waitForMessage(ServerMsgType.MoveResult);

    player.sendMsg({ type: ClientMsgType.SectorDisplay });
    const msg = await player.waitForMessage(ServerMsgType.SectorDisplayResult);
    assert.ok('planets' in msg, 'sectorDisplay should include planets field');
    assert.ok(Array.isArray(msg.planets), 'planets should be an array');
    assert.equal(msg.planets.length, 0, 'sector with no planets should return empty array');
  });
});



describe('WS: land command returns planet list', () => {
  let universeId;
  let player;
  let planetSector; // a non-sector-1 sector that has a planet

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'WsLandList', sectors: 20, seed: 70003,
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;

    // Find a warp target from sector 1 and place a planet there for testing
    const warps = await pool.query(
      `SELECT s_to.sector_number AS sector_to, s_to.id AS sector_db_id
       FROM warps w
       JOIN sectors s_from ON w.from_sector_id = s_from.id
       JOIN sectors s_to ON w.to_sector_id = s_to.id
       WHERE s_from.sector_number = 1 AND s_from.universe_id = $1 LIMIT 1`,
      [universeId],
    );
    assert.ok(warps.rows.length > 0, 'need a warp target from sector 1');
    planetSector = warps.rows[0].sector_to;
    const sectorDbId = warps.rows[0].sector_db_id;

    // Ensure a planet exists in that sector
    await pool.query(
      `INSERT INTO planets (sector_id, name, type) VALUES ($1, 'TestPlanet', 'Terran')
       ON CONFLICT DO NOTHING`,
      [sectorDbId],
    );

    player = await createTestPlayer(universeId);
  });

  after(() => { player?.close(); });

  it('sector 1 land auto-lands on Earth', async () => {
    player.sendMsg({ type: ClientMsgType.GetSectorPlanets });
    const msg = await player.waitForMessage(ServerMsgType.LandOnPlanetResult);
    assert.ok('name' in msg, 'auto-land result should include planet name');
    assert.equal(msg.name, 'Earth', 'sector 1 should auto-land on Earth');
    assert.ok('planetType' in msg, 'auto-land result should include planetType');
    assert.ok('id' in msg, 'auto-land result should include planet id');

    // Leave the planet so subsequent tests can move
    player.sendMsg({ type: ClientMsgType.LeavePlanet });
    await player.waitForMessage(ServerMsgType.LeavePlanetResult);
  });

  it('land in non-sector-1 with planets returns planet list', async () => {
    player.sendMsg({ type: ClientMsgType.Move, sector: planetSector });
    await player.waitForMessage(ServerMsgType.MoveResult);

    player.sendMsg({ type: ClientMsgType.GetSectorPlanets });
    const msg = await player.waitForMessage(ServerMsgType.GetSectorPlanetsResult);
    assert.ok('planets' in msg, 'planetList should include planets field');
    assert.ok(Array.isArray(msg.planets), 'planets should be an array');
    assert.ok(msg.planets.length >= 1, 'sector should have at least one planet');
    assert.ok('id' in msg.planets[0], 'planet should have id');
    assert.ok('type' in msg.planets[0], 'planet should have type');
  });

  it('land command in sector with no planets returns empty planetList', async () => {
    // Find another warp target and ensure it has no planets
    const warps = await pool.query(
      `SELECT s_to.sector_number AS sector_to, s_to.id AS sector_db_id
       FROM warps w
       JOIN sectors s_from ON w.from_sector_id = s_from.id
       JOIN sectors s_to ON w.to_sector_id = s_to.id
       WHERE s_from.sector_number = $1 AND s_from.universe_id = $2
         AND s_to.sector_number != 1
       LIMIT 1`,
      [planetSector, universeId],
    );
    assert.ok(warps.rows.length > 0, 'need a warp target');
    const targetSector = warps.rows[0].sector_to;
    const targetSectorDbId = warps.rows[0].sector_db_id;

    // Ensure no planets in that sector
    await pool.query('DELETE FROM planets WHERE sector_id = $1', [targetSectorDbId]);

    player.sendMsg({ type: ClientMsgType.Move, sector: targetSector });
    await player.waitForMessage(ServerMsgType.MoveResult);

    player.sendMsg({ type: ClientMsgType.GetSectorPlanets });
    const msg = await player.waitForMessage(ServerMsgType.GetSectorPlanetsResult);
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
      "SELECT p.id FROM planets p JOIN sectors s ON p.sector_id = s.id WHERE s.universe_id = $1 AND p.name = 'Earth'",
      [universeId],
    );
    const earthId = planets.rows[0].id;

    player.sendMsg({ type: ClientMsgType.LandOnPlanet, planetId: earthId });
    const msg = await player.waitForMessage(ServerMsgType.LandOnPlanetResult);
    assert.ok(msg, 'should receive planetDisplayResult');
    assert.equal(msg.id, earthId);
    assert.equal(msg.name, 'Earth');
    assert.ok('type' in msg, 'should include type');
    assert.ok('drones' in msg, 'should include drones');
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
    player.sendMsg({ type: ClientMsgType.PlanetDisplay });
    const msg = await player.waitForMessage(ServerMsgType.PlanetDisplayResult);
    assert.ok(msg, 'should receive planetDisplayResult');
    assert.equal(msg.name, 'Earth');
  });

  it('on_planet_id is cleared after leaving planet', async () => {
    player.sendMsg({ type: ClientMsgType.LeavePlanet });
    await player.waitForMessage(ServerMsgType.LeavePlanetResult);
    const res = await pool.query('SELECT on_planet_id FROM players WHERE id = $1', [player.playerId]);
    assert.equal(res.rows[0].on_planet_id, null, 'on_planet_id should be null after leaving');
  });
});

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
      `SELECT s_to.sector_number AS sector_to, s_to.id AS sector_db_id
       FROM warps w
       JOIN sectors s_from ON w.from_sector_id = s_from.id
       JOIN sectors s_to ON w.to_sector_id = s_to.id
       WHERE s_from.sector_number = 1 AND s_from.universe_id = $1 LIMIT 1`,
      [universeId],
    );
    if (warps.rows.length > 0) {
      const target = warps.rows[0].sector_to;
      player.sendMsg({ type: ClientMsgType.Move, sector: target });
      await player.waitForMessage(ServerMsgType.MoveResult);
    }

    player.sendMsg({ type: ClientMsgType.UseTerraformDevice });
    const msg = await player.waitForMessage('useTerraformDeviceResult');
    assert.equal(msg.success, false);
    assert.equal(msg.reason, 'no_devices');
    assert.ok('terraformDevices' in msg, 'no_devices response should include terraformDevices count');
    assert.equal(msg.terraformDevices, 0, 'terraformDevices should be 0');
  });

  it('useTerraformDevice in sector 1 returns restricted_sector', async () => {
    // Give the player a terraform device via DB
    await pool.query(`INSERT INTO ship_hardware (ship_id, hardware_item_id, quantity) VALUES ((SELECT ship_id FROM players WHERE id = $1), (SELECT id FROM hardware_item WHERE name = 'terraform_device'), 1) ON CONFLICT (ship_id, hardware_item_id) DO UPDATE SET quantity = 1`, [player.playerId]);

    // Move back to sector 1
    const currentSector = (await pool.query('SELECT s.sector_number FROM players p JOIN sectors s ON p.current_sector_id = s.id WHERE p.id = $1', [player.playerId])).rows[0].sector_number;
    if (currentSector !== 1) {
      // Navigate back — find a path
      player.sendMsg({ type: ClientMsgType.ShortestPath, from: currentSector, to: 1 });
      const pathMsg = await player.waitForMessage('shortestPathResult');
      for (const step of pathMsg.path.slice(1)) {
        player.sendMsg({ type: ClientMsgType.Move, sector: step.sector });
        await player.waitForMessage(ServerMsgType.MoveResult);
      }
    }

    player.sendMsg({ type: ClientMsgType.UseTerraformDevice });
    const msg = await player.waitForMessage('useTerraformDeviceResult');
    assert.equal(msg.success, false);
    assert.equal(msg.reason, 'restricted_sector');

    // Terraform device should NOT have been consumed
    const shipRes = await pool.query(`SELECT COALESCE(sh.quantity, 0) as terraform_devices FROM ships s LEFT JOIN ship_hardware sh ON sh.ship_id = s.id AND sh.hardware_item_id = (SELECT id FROM hardware_item WHERE name = 'terraform_device') WHERE s.id = (SELECT ship_id FROM players WHERE id = $1)`, [player.playerId]);
    assert.equal(shipRes.rows[0].terraform_devices, 1, 'device should not be consumed on restricted sector');
  });

  it('useTerraformDevice in a valid sector creates a planet', async () => {
    // Move to a non-restricted, non-Starbase sector
    const warps = await pool.query(
      `SELECT s_to.sector_number AS sector_to, s_to.id AS sector_db_id
       FROM warps w
       JOIN sectors s_from ON w.from_sector_id = s_from.id
       JOIN sectors s_to ON w.to_sector_id = s_to.id
       WHERE s_from.sector_number = 1 AND s_from.universe_id = $1 AND s_to.name != 'Starbase' LIMIT 1`,
      [universeId],
    );
    assert.ok(warps.rows.length > 0, 'should have a warp from sector 1');
    const targetSector = warps.rows[0].sector_to;
    const targetSectorDbId = warps.rows[0].sector_db_id;

    player.sendMsg({ type: ClientMsgType.Move, sector: targetSector });
    await player.waitForMessage(ServerMsgType.MoveResult);

    // Give the player a terraform device
    await pool.query(`INSERT INTO ship_hardware (ship_id, hardware_item_id, quantity) VALUES ((SELECT ship_id FROM players WHERE id = $1), (SELECT id FROM hardware_item WHERE name = 'terraform_device'), 1) ON CONFLICT (ship_id, hardware_item_id) DO UPDATE SET quantity = 1`, [player.playerId]);

    const planetsBefore = await pool.query(
      'SELECT COUNT(*)::int as cnt FROM planets WHERE sector_id = $1',
      [targetSectorDbId],
    );

    player.sendMsg({ type: ClientMsgType.UseTerraformDevice });
    const msg = await player.waitForMessage('useTerraformDeviceResult');
    assert.equal(msg.success, true, 'terraform should succeed');
    assert.ok(msg.planet, 'should include planet info');
    assert.ok(msg.planet.id, 'planet should have id');
    assert.ok(msg.planet.name, 'planet should have name');
    assert.ok(msg.planet.type, 'planet should have type');
    assert.ok('sectorId' in msg.planet || 'sector_id' in msg.planet, 'planet should have sectorId');

    const planetsAfter = await pool.query(
      'SELECT COUNT(*)::int as cnt FROM planets WHERE sector_id = $1',
      [targetSectorDbId],
    );
    assert.equal(planetsAfter.rows[0].cnt, planetsBefore.rows[0].cnt + 1, 'should have one more planet');

    // Terraform device should be consumed
    const shipRes = await pool.query(
      `SELECT COALESCE(sh.quantity, 0) as qty FROM ships s
       LEFT JOIN ship_hardware sh ON sh.ship_id = s.id
         AND sh.hardware_item_id = (SELECT id FROM hardware_item WHERE name = 'terraform_device')
       WHERE s.id = (SELECT ship_id FROM players WHERE id = $1)`,
      [player.playerId],
    );
    assert.equal(shipRes.rows[0].qty, 0, 'device should be consumed');
  });
});

describe('WS: starbase and hardware store', () => {
  let universeId;
  let player;
  let starbaseSector;

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'WsStarbase', sectors: 20, seed: 70006,
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;

    // Find the starbase sector
    const sdRes = await pool.query(
      "SELECT sector_number FROM sectors WHERE name = 'Starbase' AND universe_id = $1",
      [universeId],
    );
    assert.ok(sdRes.rows.length > 0, 'Starbase sector should exist');
    starbaseSector = sdRes.rows[0].sector_number;

    player = await createTestPlayer(universeId);

    // Navigate to starbase
    player.sendMsg({ type: ClientMsgType.ShortestPath, from: 1, to: starbaseSector });
    const pathMsg = await player.waitForMessage('shortestPathResult');
    for (const step of pathMsg.path.slice(1)) {
      player.sendMsg({ type: ClientMsgType.Move, sector: step.sector });
      // Consume whatever comes back (moveResult success or encounter)
      await player.waitForMessage(ServerMsgType.MoveResult).catch(() => null);
    }
  });

  after(() => { player?.close(); });

  it('dockStarbase at class 9 port responds with starbaseMenu', async () => {
    player.sendMsg({ type: ClientMsgType.DockStarbase });
    const msg = await player.waitForMessage('dockStarbaseResult');
    assert.ok(msg, 'should receive starbaseMenu');
  });

  it('buyHardware with insufficient credits returns error', async () => {
    // Drain credits
    await pool.query('UPDATE players SET credits = 0 WHERE id = $1', [player.playerId]);
    player.sendMsg({ type: ClientMsgType.BuyHardware, itemName: 'planet_buster', quantity: 1 });
    const msg = await player.waitForMessage('error');
    assert.ok(msg.message, 'should have error message');
  });

  it('buyHardware planet_buster with sufficient credits succeeds', async () => {
    // Give credits and ensure ship can carry busters
    await pool.query('UPDATE players SET credits = 100000 WHERE id = $1', [player.playerId]);
    const shipConfig = JSON.parse(readFileSync(join(CONFIG_SHIPS_DIR, '..', '..', 'config', 'ships', '01-vulpeculan-cruiser.json'), 'utf8'));

    // If Vulpeculan Cruiser can't carry busters, give them a different ship
    if (shipConfig.maxPlanetBusters === 0) {
      const allConfigs = readdirSync(CONFIG_SHIPS_DIR).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(CONFIG_SHIPS_DIR, f), 'utf8')));
      const busterShip = allConfigs.find(c => c.maxPlanetBusters > 0);
      assert.ok(busterShip, 'at least one ship config must have maxPlanetBusters > 0');
      await pool.query('UPDATE ships SET ship_type_id = (SELECT id FROM ship_types WHERE name = $1) WHERE id = (SELECT ship_id FROM players WHERE id = $2)', [busterShip.name, player.playerId]);
    }

    player.sendMsg({ type: ClientMsgType.BuyHardware, itemName: 'planet_buster', quantity: 1 });
    const msg = await player.waitForMessage('buyHardwareResult');
    assert.ok(msg, 'should receive buyHardwareResult');
    assert.equal(msg.type, 'buyHardwareResult');
    assert.equal(msg.quantity, 1);
    assert.ok('totalOnShip' in msg, 'should include totalOnShip');
    assert.ok('credits' in msg, 'should include remaining credits');
  });

  it('buyHardware terraform_device succeeds', async () => {
    await pool.query('UPDATE players SET credits = 100000 WHERE id = $1', [player.playerId]);
    // Ensure ship supports terraform devices (previous test may have switched to a buster-only ship)
    const allConfigs = readdirSync(CONFIG_SHIPS_DIR).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(CONFIG_SHIPS_DIR, f), 'utf8')));
    const terraShip = allConfigs.find(c => c.maxTerraformDevices > 0);
    assert.ok(terraShip, 'at least one ship config must have maxTerraformDevices > 0');
    await pool.query('UPDATE ships SET ship_type_id = (SELECT id FROM ship_types WHERE name = $1) WHERE id = (SELECT ship_id FROM players WHERE id = $2)', [terraShip.name, player.playerId]);
    player.sendMsg({ type: ClientMsgType.BuyHardware, itemName: 'terraform_device', quantity: 1 });
    const msg = await player.waitForMessage('buyHardwareResult');
    assert.ok(msg, 'should receive buyHardwareResult');
    assert.equal(msg.type, 'buyHardwareResult');
    assert.equal(msg.quantity, 1);
  });

  it('leaveStarbase responds with leaveStarbaseResult', async () => {
    player.sendMsg({ type: ClientMsgType.LeaveStarbase });
    const msg = await player.waitForMessage('leaveStarbaseResult');
    assert.ok(msg, 'should receive sectorDisplay after leaving starbase');
  });
});

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
    player.sendMsg({ type: ClientMsgType.DestroyPlanet });
    const msg = await player.waitForMessage('error');
    assert.ok(msg.message, 'should have error message');
  });

  it('destroyPlanet without planet busters returns error', async () => {
    // Land on Earth first
    const planets = await pool.query(
      "SELECT p.id FROM planets p JOIN sectors s ON p.sector_id = s.id WHERE s.universe_id = $1 AND p.name = 'Earth'", [universeId],
    );
    const earthId = planets.rows[0].id;
    player.sendMsg({ type: ClientMsgType.LandOnPlanet, planetId: earthId });
    await player.waitForMessage(ServerMsgType.LandOnPlanetResult);

    // Make sure no planet busters
    await pool.query(`INSERT INTO ship_hardware (ship_id, hardware_item_id, quantity) VALUES ((SELECT ship_id FROM players WHERE id = $1), (SELECT id FROM hardware_item WHERE name = 'planet_buster'), 0) ON CONFLICT (ship_id, hardware_item_id) DO UPDATE SET quantity = 0`, [player.playerId]);

    player.sendMsg({ type: ClientMsgType.DestroyPlanet });
    const msg = await player.waitForMessage('error');
    assert.ok(msg.message, 'should have error message about no busters');
  });

  it('destroyPlanet with busters destroys the planet', async () => {
    // Create a disposable planet to destroy
    const sectorRes = await pool.query(
      `SELECT s_to.sector_number AS sector_to, s_to.id AS sector_db_id
       FROM warps w
       JOIN sectors s_from ON w.from_sector_id = s_from.id
       JOIN sectors s_to ON w.to_sector_id = s_to.id
       WHERE s_from.sector_number = 1 AND s_from.universe_id = $1 AND s_to.name != 'Starbase' LIMIT 1`,
      [universeId],
    );
    const targetSector = sectorRes.rows[0].sector_to;
    const targetSectorDbId = sectorRes.rows[0].sector_db_id;

    // Insert a test planet
    const ins = await pool.query(
      "INSERT INTO planets (sector_id, name, type) VALUES ($1, 'Doomed', 'Barren') RETURNING id",
      [targetSectorDbId],
    );
    const newPlanetId = ins.rows[0].id;

    // Move to that sector
    player.sendMsg({ type: ClientMsgType.LeavePlanet });
    await player.waitForMessage('leavePlanetResult').catch(() => null);

    player.sendMsg({ type: ClientMsgType.ShortestPath, from: 1, to: targetSector });
    const pathMsg = await player.waitForMessage('shortestPathResult');
    for (const step of pathMsg.path.slice(1)) {
      player.sendMsg({ type: ClientMsgType.Move, sector: step.sector });
      await player.waitForMessage(ServerMsgType.MoveResult);
    }

    // Land on the doomed planet
    player.sendMsg({ type: ClientMsgType.LandOnPlanet, planetId: newPlanetId });
    await player.waitForMessage(ServerMsgType.LandOnPlanetResult);

    // Give planet buster
    await pool.query(`INSERT INTO ship_hardware (ship_id, hardware_item_id, quantity) VALUES ((SELECT ship_id FROM players WHERE id = $1), (SELECT id FROM hardware_item WHERE name = 'planet_buster'), 1) ON CONFLICT (ship_id, hardware_item_id) DO UPDATE SET quantity = 1`, [player.playerId]);

    player.sendMsg({ type: ClientMsgType.DestroyPlanet });
    const msg = await player.waitForMessage('destroyPlanetResult');
    assert.equal(msg.destroyed, true);
    assert.equal(msg.planetId, newPlanetId);
    assert.ok('planetName' in msg, 'destroyPlanetResult should include planetName');
    assert.equal(msg.planetName, 'Doomed', 'planetName should match the destroyed planet');

    // Verify planet is gone from DB
    const check = await pool.query('SELECT COUNT(*)::int as cnt FROM planets WHERE id = $1', [newPlanetId]);
    assert.equal(check.rows[0].cnt, 0, 'planet should be deleted from DB');

    // Verify planet buster was consumed
    const shipRes = await pool.query(`SELECT COALESCE(sh.quantity, 0) as planet_busters FROM ships s LEFT JOIN ship_hardware sh ON sh.ship_id = s.id AND sh.hardware_item_id = (SELECT id FROM hardware_item WHERE name = 'planet_buster') WHERE s.id = (SELECT ship_id FROM players WHERE id = $1)`, [player.playerId]);
    assert.equal(shipRes.rows[0].planet_busters, 0, 'planet buster should be consumed');

    // Should also receive a sectorDisplay after destruction
    const sectorMsg = await player.waitForMessage(ServerMsgType.SectorDisplayResult);
    assert.ok(sectorMsg, 'should receive sectorDisplay after planet destruction');
  });
});


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
      `SELECT s_to.sector_number AS sector_to, s_to.id AS sector_db_id
       FROM warps w
       JOIN sectors s_from ON w.from_sector_id = s_from.id
       JOIN sectors s_to ON w.to_sector_id = s_to.id
       WHERE s_from.sector_number = 1 AND s_from.universe_id = $1 LIMIT 1`,
      [universeId],
    );
    const otherSectorDbId = warps.rows[0].sector_db_id;
    const ins = await pool.query(
      "INSERT INTO planets (sector_id, name, type) VALUES ($1, 'FarPlanet', 'Barren') RETURNING id",
      [otherSectorDbId],
    );
    const planetId = ins.rows[0].id;

    // Player is in sector 1, try to land on planet in otherSector
    player.sendMsg({ type: ClientMsgType.LandOnPlanet, planetId });
    const msg = await player.waitForMessage('error');
    assert.ok(msg.message, 'should receive error for planet not in current sector');

    await pool.query('DELETE FROM planets WHERE id = $1', [planetId]);
  });
});


describe('WS: buy hardware exceeds ship maximum', () => {
  let universeId;
  let player;
  let starbaseSector;

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'WsHardwareMax', sectors: 20, seed: 70009,
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;

    const sdRes = await pool.query(
      "SELECT sector_number FROM sectors WHERE name = 'Starbase' AND universe_id = $1",
      [universeId],
    );
    starbaseSector = sdRes.rows[0].sector_number;

    player = await createTestPlayer(universeId);

    // Navigate to starbase
    player.sendMsg({ type: ClientMsgType.ShortestPath, from: 1, to: starbaseSector });
    const pathMsg = await player.waitForMessage('shortestPathResult');
    for (const step of pathMsg.path.slice(1)) {
      player.sendMsg({ type: ClientMsgType.Move, sector: step.sector });
      await player.waitForMessage(ServerMsgType.MoveResult).catch(() => null);
    }

    // Dock at starbase
    player.sendMsg({ type: ClientMsgType.DockStarbase });
    await player.waitForMessage('dockStarbaseResult');
  });

  after(() => { player?.close(); });

  it('buyPlanetBusters exceeding ship max returns error', async () => {
    await pool.query('UPDATE players SET credits = 10000000 WHERE id = $1', [player.playerId]);

    // Find ship max
    const shipRes = await pool.query('SELECT st.name as ship_name FROM ships s JOIN ship_types st ON s.ship_type_id = st.id WHERE s.id = (SELECT ship_id FROM players WHERE id = $1)', [player.playerId]);
    const allConfigs = readdirSync(CONFIG_SHIPS_DIR).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(CONFIG_SHIPS_DIR, f), 'utf8')));
    const shipConfig = allConfigs.find(c => c.name === shipRes.rows[0].ship_name);

    // Try buying more than max
    const overMax = (shipConfig?.maxPlanetBusters || 0) + 10;
    player.sendMsg({ type: ClientMsgType.BuyHardware, itemName: 'planet_buster', quantity: overMax });
    const msg = await player.waitForMessage('error');
    assert.ok(msg.message, 'should return error when exceeding max planet busters');
  });

  it('buyPlanetBusters exceeding ship max cumulatively returns error', async () => {
    await pool.query('UPDATE players SET credits = 10000000 WHERE id = $1', [player.playerId]);

    const shipRes = await pool.query('SELECT st.name as ship_name FROM ships s JOIN ship_types st ON s.ship_type_id = st.id WHERE s.id = (SELECT ship_id FROM players WHERE id = $1)', [player.playerId]);
    const allConfigs = readdirSync(CONFIG_SHIPS_DIR).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(CONFIG_SHIPS_DIR, f), 'utf8')));
    const busterShip = allConfigs.find(c => c.maxPlanetBusters >= 2);
    if (busterShip) {
      // Set current inventory to max - 1
      await pool.query('UPDATE ships SET ship_type_id = (SELECT id FROM ship_types WHERE name = $1) WHERE id = (SELECT ship_id FROM players WHERE id = $2)',
        [busterShip.name, player.playerId]);
      await pool.query('INSERT INTO ship_hardware (ship_id, hardware_item_id, quantity) VALUES ((SELECT ship_id FROM players WHERE id = $1), (SELECT id FROM hardware_item WHERE name = \'planet_buster\'), $2) ON CONFLICT (ship_id, hardware_item_id) DO UPDATE SET quantity = $2',
        [player.playerId, busterShip.maxPlanetBusters - 1]);

      // Try buying 2 more, which should exceed max
      player.sendMsg({ type: ClientMsgType.BuyHardware, itemName: 'planet_buster', quantity: 2 });
      const msg = await player.waitForMessage('error');
      assert.ok(msg.message, 'should return error when cumulative total exceeds max');
    }
  });

  it('buyTerraformDevices exceeding ship max returns error', async () => {
    await pool.query('UPDATE players SET credits = 10000000 WHERE id = $1', [player.playerId]);

    const shipRes = await pool.query('SELECT st.name as ship_name FROM ships s JOIN ship_types st ON s.ship_type_id = st.id WHERE s.id = (SELECT ship_id FROM players WHERE id = $1)', [player.playerId]);
    const allConfigs = readdirSync(CONFIG_SHIPS_DIR).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(CONFIG_SHIPS_DIR, f), 'utf8')));
    const shipConfig = allConfigs.find(c => c.name === shipRes.rows[0].ship_name);

    const overMax = (shipConfig?.maxTerraformDevices || 0) + 10;
    player.sendMsg({ type: ClientMsgType.BuyHardware, itemName: 'terraform_device', quantity: overMax });
    const msg = await player.waitForMessage('error');
    assert.ok(msg.message, 'should return error when exceeding max terraform devices');
  });

  it('dockStarbase in non-class-9 sector returns error', async () => {
    // Leave starbase first
    player.sendMsg({ type: ClientMsgType.LeaveStarbase });
    await player.waitForMessage('leaveStarbaseResult').catch(() => null);

    // Move to sector 1 (which has class 0 port, not class 9)
    player.sendMsg({ type: ClientMsgType.ShortestPath, from: starbaseSector, to: 1 });
    const pathMsg = await player.waitForMessage('shortestPathResult');
    for (const step of pathMsg.path.slice(1)) {
      player.sendMsg({ type: ClientMsgType.Move, sector: step.sector });
      await player.waitForMessage(ServerMsgType.MoveResult).catch(() => null);
    }

    player.sendMsg({ type: ClientMsgType.DockStarbase });
    const msg = await player.waitForMessage('error');
    assert.ok(msg.message, 'should return error for dockStarbase in non-class-9 sector');
  });
});


describe('WS: buy hardware requires starbase docking', () => {
  let universeId;
  let player;
  let starbaseSector;

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'WsStarbaseFlag', sectors: 20, seed: 70015,
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;

    const sdRes = await pool.query(
      "SELECT sector_number FROM sectors WHERE name = 'Starbase' AND universe_id = $1",
      [universeId],
    );
    starbaseSector = sdRes.rows[0].sector_number;

    player = await createTestPlayer(universeId);

    // Navigate to starbase sector but do NOT call dockStarbase
    player.sendMsg({ type: ClientMsgType.ShortestPath, from: 1, to: starbaseSector });
    const pathMsg = await player.waitForMessage('shortestPathResult');
    for (const step of pathMsg.path.slice(1)) {
      player.sendMsg({ type: ClientMsgType.Move, sector: step.sector });
      await player.waitForMessage(ServerMsgType.MoveResult).catch(() => null);
    }

    // Give credits and a ship that can carry busters
    await pool.query('UPDATE players SET credits = 100000 WHERE id = $1', [player.playerId]);
    const allConfigs = readdirSync(CONFIG_SHIPS_DIR).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(CONFIG_SHIPS_DIR, f), 'utf8')));
    const busterShip = allConfigs.find(c => c.maxPlanetBusters > 0);
    if (busterShip) {
      await pool.query('UPDATE ships SET ship_type_id = (SELECT id FROM ship_types WHERE name = $1) WHERE id = (SELECT ship_id FROM players WHERE id = $2)', [busterShip.name, player.playerId]);
    }
  });

  after(() => { player?.close(); });

  it('buyPlanetBusters in starbase sector without docking returns error', async () => {
    player.sendMsg({ type: ClientMsgType.BuyHardware, itemName: 'planet_buster', quantity: 1 });
    const msg = await player.waitForMessage('error');
    assert.ok(msg.message, 'should return error when not docked at starbase');
  });

  it('buyTerraformDevices in starbase sector without docking returns error', async () => {
    const allConfigs = readdirSync(CONFIG_SHIPS_DIR).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(CONFIG_SHIPS_DIR, f), 'utf8')));
    const terraShip = allConfigs.find(c => c.maxTerraformDevices > 0);
    if (terraShip) {
      await pool.query('UPDATE ships SET ship_type_id = (SELECT id FROM ship_types WHERE name = $1) WHERE id = (SELECT ship_id FROM players WHERE id = $2)', [terraShip.name, player.playerId]);
    }
    player.sendMsg({ type: ClientMsgType.BuyHardware, itemName: 'terraform_device', quantity: 1 });
    const msg = await player.waitForMessage('error');
    assert.ok(msg.message, 'should return error when not docked at starbase');
  });
});

describe('WS: buy hardware credit deduction', () => {
  let universeId;
  let player;
  let starbaseSector;

  before(async () => {
    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'WsCreditDeduct', sectors: 20, seed: 70010,
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;

    const sdRes = await pool.query(
      "SELECT sector_number FROM sectors WHERE name = 'Starbase' AND universe_id = $1",
      [universeId],
    );
    starbaseSector = sdRes.rows[0].sector_number;

    player = await createTestPlayer(universeId);

    // Navigate to starbase
    player.sendMsg({ type: ClientMsgType.ShortestPath, from: 1, to: starbaseSector });
    const pathMsg = await player.waitForMessage('shortestPathResult');
    for (const step of pathMsg.path.slice(1)) {
      player.sendMsg({ type: ClientMsgType.Move, sector: step.sector });
      await player.waitForMessage(ServerMsgType.MoveResult).catch(() => null);
    }

    player.sendMsg({ type: ClientMsgType.DockStarbase });
    await player.waitForMessage('dockStarbaseResult');
  });

  after(() => { player?.close(); });

  it('buyPlanetBusters deducts credits per buster (price from universe_settings)', async () => {
    // Find a ship that can carry planet busters
    const allConfigs = readdirSync(CONFIG_SHIPS_DIR).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(CONFIG_SHIPS_DIR, f), 'utf8')));
    const busterShip = allConfigs.find(c => c.maxPlanetBusters >= 2);
    assert.ok(busterShip, 'need at least one ship config with maxPlanetBusters >= 2');
    await pool.query('UPDATE ships SET ship_type_id = (SELECT id FROM ship_types WHERE name = $1) WHERE id = (SELECT ship_id FROM players WHERE id = $2)', [busterShip.name, player.playerId]);
    await pool.query('INSERT INTO ship_hardware (ship_id, hardware_item_id, quantity) VALUES ((SELECT ship_id FROM players WHERE id = $1), (SELECT id FROM hardware_item WHERE name = \'planet_buster\'), 0) ON CONFLICT (ship_id, hardware_item_id) DO UPDATE SET quantity = 0', [player.playerId]);
    await pool.query('UPDATE players SET credits = 200000 WHERE id = $1', [player.playerId]);

    player.sendMsg({ type: ClientMsgType.BuyHardware, itemName: 'planet_buster', quantity: 2 });
    const msg = await player.waitForMessage('buyHardwareResult');
    assert.equal(msg.type, 'buyHardwareResult');
    assert.equal(msg.quantity, 2);
    // Price comes from universe_settings (default 40000 per buster)
    assert.equal(msg.credits, 120000, 'should deduct 80000 (2 * 40000) from 200000');
    assert.equal(msg.totalOnShip, 2);
  });

  it('buyTerraformDevices deducts credits per device (price from universe_settings)', async () => {
    // Find a ship that can carry terraform devices
    const allConfigs = readdirSync(CONFIG_SHIPS_DIR).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(CONFIG_SHIPS_DIR, f), 'utf8')));
    const terraShip = allConfigs.find(c => c.maxTerraformDevices >= 2);
    assert.ok(terraShip, 'need at least one ship config with maxTerraformDevices >= 2');
    await pool.query('UPDATE ships SET ship_type_id = (SELECT id FROM ship_types WHERE name = $1) WHERE id = (SELECT ship_id FROM players WHERE id = $2)', [terraShip.name, player.playerId]);
    await pool.query('INSERT INTO ship_hardware (ship_id, hardware_item_id, quantity) VALUES ((SELECT ship_id FROM players WHERE id = $1), (SELECT id FROM hardware_item WHERE name = \'terraform_device\'), 0) ON CONFLICT (ship_id, hardware_item_id) DO UPDATE SET quantity = 0', [player.playerId]);
    await pool.query('UPDATE players SET credits = 200000 WHERE id = $1', [player.playerId]);

    player.sendMsg({ type: ClientMsgType.BuyHardware, itemName: 'terraform_device', quantity: 2 });
    const msg = await player.waitForMessage('buyHardwareResult');
    assert.equal(msg.type, 'buyHardwareResult');
    assert.equal(msg.quantity, 2);
    // Price comes from universe_settings (default 25000 per device)
    assert.equal(msg.credits, 150000, 'should deduct 50000 (2 * 25000) from 200000');
    assert.equal(msg.totalOnShip, 2);
  });

  it('buyPlanetBusters when not at starbase returns error', async () => {
    // Leave starbase
    player.sendMsg({ type: ClientMsgType.LeaveStarbase });
    await player.waitForMessage('leaveStarbaseResult').catch(() => null);

    player.sendMsg({ type: ClientMsgType.BuyHardware, itemName: 'planet_buster', quantity: 1 });
    const msg = await player.waitForMessage('error');
    assert.ok(msg.message, 'should return error when not at starbase');
  });
});


describe('WS: terraform collision logic', () => {
  let universeId;
  let player;
  let targetSector;

  before(async () => {
    // Create a custom template with max_planets_per_sector=1 and collision_likelihood=100.
    await pool.query(
      `INSERT INTO universe_template (name, max_planets_per_sector, planet_collision_likelihood, planet_collision_min_hours, planet_collision_max_hours)
       VALUES ('collision_test', 1, 100, 1, 48)
       ON CONFLICT (name) DO UPDATE SET max_planets_per_sector = 1, planet_collision_likelihood = 100, planet_collision_min_hours = 1, planet_collision_max_hours = 48`,
    );

    const res = await adminKeyPost('/api/admin/universes/generate', {
      name: 'WsCollision', sectors: 20, seed: 70011, edit_name: 'collision_test',
    });
    assert.equal(res.status, 201);
    universeId = res.body.id;

    player = await createTestPlayer(universeId);

    // Find a non-restricted sector with a warp from sector 1
    const warps = await pool.query(
      `SELECT s_to.sector_number AS sector_to, s_to.id AS sector_db_id
       FROM warps w
       JOIN sectors s_from ON w.from_sector_id = s_from.id
       JOIN sectors s_to ON w.to_sector_id = s_to.id
       WHERE s_from.sector_number = 1 AND s_from.universe_id = $1 AND s_to.name != 'Starbase' LIMIT 1`,
      [universeId],
    );
    assert.ok(warps.rows.length > 0, 'need a warp target');
    targetSector = warps.rows[0].sector_to;
    const targetSectorDbId = warps.rows[0].sector_db_id;

    // Move to that sector
    player.sendMsg({ type: ClientMsgType.Move, sector: targetSector });
    await player.waitForMessage(ServerMsgType.MoveResult);

    // Seed an existing planet in the sector so it already has 1 (which equals max)
    await pool.query(
      "INSERT INTO planets (sector_id, name, type) VALUES ($1, 'ExistingP', 'Terran')",
      [targetSectorDbId],
    );
  });

  after(() => { player?.close(); });

  it('terraformResult succeeds even when sector is at max capacity', async () => {
    // Sector already has 1 planet and max_planets_per_sector=1, so it's at capacity
    await pool.query(`INSERT INTO ship_hardware (ship_id, hardware_item_id, quantity) VALUES ((SELECT ship_id FROM players WHERE id = $1), (SELECT id FROM hardware_item WHERE name = 'terraform_device'), 1) ON CONFLICT (ship_id, hardware_item_id) DO UPDATE SET quantity = 1`, [player.playerId]);

    player.sendMsg({ type: ClientMsgType.UseTerraformDevice });
    const msg = await player.waitForMessage('useTerraformDeviceResult');
    assert.equal(msg.success, true, 'terraform should still succeed even at capacity');
    assert.ok('collision' in msg, 'terraformResult should include collision field');
  });

  it('terraform in sector at max capacity creates planet and collision row', async () => {
    // Give terraform device
    await pool.query(`INSERT INTO ship_hardware (ship_id, hardware_item_id, quantity) VALUES ((SELECT ship_id FROM players WHERE id = $1), (SELECT id FROM hardware_item WHERE name = 'terraform_device'), 1) ON CONFLICT (ship_id, hardware_item_id) DO UPDATE SET quantity = 1`, [player.playerId]);

    player.sendMsg({ type: ClientMsgType.UseTerraformDevice });
    const msg = await player.waitForMessage('useTerraformDeviceResult');
    assert.equal(msg.success, true, 'terraform should succeed');
    assert.ok(msg.planet, 'should include planet info');
    assert.ok(msg.planet.name, 'planet should have a name');
    assert.ok(msg.planet.type, 'planet should have a type');
    assert.ok('collision' in msg, 'terraformResult should include collision boolean');
    assert.equal(msg.collision, true, 'collision should be true since likelihood is 100');

    // Verify a collision row exists in the DB for this specific planet
    const collisionRes = await pool.query(
      'SELECT collision_planet, colliding_with, collision_at FROM planet_collisions WHERE collision_planet = $1',
      [msg.planet.id],
    );
    assert.ok(collisionRes.rows.length >= 1, 'should have a collision row for the new planet');
    const collision = collisionRes.rows[0];
    assert.equal(collision.collision_planet, msg.planet.id, 'collision_planet should be the new planet');

    // Verify colliding_with is a planet in the same sector
    const collidingPlanet = await pool.query(
      `SELECT s.sector_number FROM planets p JOIN sectors s ON p.sector_id = s.id WHERE p.id = $1`,
      [collision.colliding_with],
    );
    assert.ok(collidingPlanet.rows.length > 0, 'colliding_with should reference an existing planet');
    assert.equal(collidingPlanet.rows[0].sector_number, targetSector, 'colliding_with planet should be in the same sector');

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
    await pool.query(`INSERT INTO ship_hardware (ship_id, hardware_item_id, quantity) VALUES ((SELECT ship_id FROM players WHERE id = $1), (SELECT id FROM hardware_item WHERE name = 'terraform_device'), 2) ON CONFLICT (ship_id, hardware_item_id) DO UPDATE SET quantity = 2`, [player.playerId]);

    player.sendMsg({ type: ClientMsgType.UseTerraformDevice });
    const msg = await player.waitForMessage('useTerraformDeviceResult');
    assert.equal(msg.success, true);
    assert.ok('terraformDevices' in msg, 'should include terraformDevices remaining count');
    assert.equal(msg.terraformDevices, 1, 'should have 1 remaining after using 1 of 2');
  });
});




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
      `SELECT s_to.sector_number AS sector_to, s_to.id AS sector_db_id
       FROM warps w
       JOIN sectors s_from ON w.from_sector_id = s_from.id
       JOIN sectors s_to ON w.to_sector_id = s_to.id
       WHERE s_from.sector_number = 1 AND s_from.universe_id = $1 AND s_to.name != 'Starbase' LIMIT 1`,
      [universeId],
    );
    const targetSector = warps.rows[0].sector_to;
    const targetSectorDbId = warps.rows[0].sector_db_id;

    // Insert a disposable planet
    const ins = await pool.query(
      "INSERT INTO planets (sector_id, name, type) VALUES ($1, 'DestroyMe', 'Barren') RETURNING id",
      [targetSectorDbId],
    );
    const newPlanetId = ins.rows[0].id;

    // Move to that sector
    player.sendMsg({ type: ClientMsgType.ShortestPath, from: 1, to: targetSector });
    const pathMsg = await player.waitForMessage('shortestPathResult');
    for (const step of pathMsg.path.slice(1)) {
      player.sendMsg({ type: ClientMsgType.Move, sector: step.sector });
      await player.waitForMessage(ServerMsgType.MoveResult);
    }

    // Land on the planet
    player.sendMsg({ type: ClientMsgType.LandOnPlanet, planetId: newPlanetId });
    await player.waitForMessage(ServerMsgType.LandOnPlanetResult);

    // Verify on_planet_id is set
    const beforeRes = await pool.query('SELECT on_planet_id FROM players WHERE id = $1', [player.playerId]);
    assert.equal(beforeRes.rows[0].on_planet_id, newPlanetId, 'on_planet_id should be set before destroy');

    // Give planet buster and destroy
    await pool.query(`INSERT INTO ship_hardware (ship_id, hardware_item_id, quantity) VALUES ((SELECT ship_id FROM players WHERE id = $1), (SELECT id FROM hardware_item WHERE name = 'planet_buster'), 1) ON CONFLICT (ship_id, hardware_item_id) DO UPDATE SET quantity = 1`, [player.playerId]);
    player.sendMsg({ type: ClientMsgType.DestroyPlanet });
    await player.waitForMessage('destroyPlanetResult');
    await player.waitForMessage(ServerMsgType.SectorDisplayResult);

    // Verify on_planet_id is cleared
    const afterRes = await pool.query('SELECT on_planet_id FROM players WHERE id = $1', [player.playerId]);
    assert.equal(afterRes.rows[0].on_planet_id, null, 'on_planet_id should be NULL after destroying planet');
  });
});

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
      `SELECT s_to.sector_number AS sector_to, s_to.id AS sector_db_id
       FROM warps w
       JOIN sectors s_from ON w.from_sector_id = s_from.id
       JOIN sectors s_to ON w.to_sector_id = s_to.id
       WHERE s_from.sector_number = 1 AND s_from.universe_id = $1 AND s_to.name != 'Starbase' LIMIT 1`,
      [universeId],
    );
    const targetSector = warps.rows[0].sector_to;
    const targetSectorDbId = warps.rows[0].sector_db_id;

    // Remove any existing planets from that sector
    await pool.query('DELETE FROM planets WHERE sector_id = $1', [targetSectorDbId]);

    player.sendMsg({ type: ClientMsgType.Move, sector: targetSector });
    await player.waitForMessage(ServerMsgType.MoveResult);

    // Give 2 terraform devices
    await pool.query(`INSERT INTO ship_hardware (ship_id, hardware_item_id, quantity) VALUES ((SELECT ship_id FROM players WHERE id = $1), (SELECT id FROM hardware_item WHERE name = 'terraform_device'), 2) ON CONFLICT (ship_id, hardware_item_id) DO UPDATE SET quantity = 2`, [player.playerId]);

    player.sendMsg({ type: ClientMsgType.UseTerraformDevice });
    const msg = await player.waitForMessage('useTerraformDeviceResult');
    assert.equal(msg.success, true);
    assert.ok('collision' in msg, 'terraformResult should include collision field');
    assert.equal(msg.collision, false, 'collision should be false when sector is below max capacity');
    assert.ok('terraformDevices' in msg, 'terraformResult should include terraformDevices count');
    assert.equal(msg.terraformDevices, 1, 'should have 1 remaining after using 1 of 2');
  });
});





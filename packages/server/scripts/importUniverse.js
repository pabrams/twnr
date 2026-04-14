#!/usr/bin/env node
/**
 * importUniverse.js
 * Imports a twnr-bigbang output directory into the server's PostgreSQL database.
 *
 * Usage: node scripts/importUniverse.js <bigbang-output-dir> [--force] [--universe-id <id>]
 *
 * The server schema is created if it doesn't already exist. Existing universe
 * data for the target universe_id (sectors, warps, ports) is wiped before import.
 * Run this while the server is not running to avoid state conflicts.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const { Pool } = pg;

const args = process.argv.slice(2);
const universeDir = args.find(a => !a.startsWith('--'));
const force = args.includes('--force');

// Parse --universe-id flag
let universeId = 1; // default
const uidIdx = args.indexOf('--universe-id');
if (uidIdx !== -1 && args[uidIdx + 1]) {
  universeId = parseInt(args[uidIdx + 1], 10);
}

if (!universeDir) {
  console.error('Usage: node scripts/importUniverse.js <bigbang-output-dir> [--force] [--universe-id <id>]');
  process.exit(1);
}

if (!force) {
  console.error('Error: this will wipe all existing universe data. Pass --force to proceed.');
  process.exit(1);
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuote = false;
  for (const ch of line) {
    if (ch === '"') { inQuote = !inQuote; }
    else if (ch === ',' && !inQuote) { result.push(current); current = ''; }
    else { current += ch; }
  }
  result.push(current);
  return result;
}

function readCSV(filepath) {
  const content = readFileSync(filepath, 'utf8');
  const lines = content.trim().split('\n');
  const header = parseCSVLine(lines[0]);
  const rows = lines.slice(1).map(parseCSVLine);
  return { header, rows };
}

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  database: process.env.PGDATABASE || 'twnr',
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
});

async function ensureSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(50) NOT NULL DEFAULT 'player',
      token_version INTEGER NOT NULL DEFAULT 1,
      last_connected_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS edits (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      max_planets_per_sector SMALLINT NOT NULL DEFAULT 2,
      planet_collision_likelihood SMALLINT NOT NULL DEFAULT 50,
      planet_collision_min_hours SMALLINT NOT NULL DEFAULT 24,
      planet_collision_max_hours SMALLINT NOT NULL DEFAULT 24,
      turns_per_day INTEGER NOT NULL DEFAULT 500,
      starting_turns INTEGER NOT NULL DEFAULT 500,
      max_turns INTEGER NOT NULL DEFAULT 2000,
      starting_ship VARCHAR(255) NOT NULL DEFAULT 'Vulpeculan Cruiser',
      starting_drones INTEGER NOT NULL DEFAULT 0,
      starting_credits INTEGER NOT NULL DEFAULT 10000,
      starting_port_density SMALLINT NOT NULL DEFAULT 50,
      max_port_density SMALLINT NOT NULL DEFAULT 100,
      port_production_rate SMALLINT NOT NULL DEFAULT 50,
      port_memory_hours INTEGER NOT NULL DEFAULT 48,
      max_players INTEGER NOT NULL DEFAULT 100,
      max_age_days INTEGER NOT NULL DEFAULT 0,
      max_planets INTEGER NOT NULL DEFAULT 500,
      turn_delay INTEGER NOT NULL DEFAULT 0,
      is_speed_warp_delay_on BOOLEAN NOT NULL DEFAULT TRUE,
      photons_allowed BOOLEAN NOT NULL DEFAULT TRUE,
      photon_blast_time_seconds INTEGER NOT NULL DEFAULT 5,
      planet_spawn_density SMALLINT NOT NULL DEFAULT 10,
      max_ships_allowed INTEGER NOT NULL DEFAULT 500,
      max_corp_size SMALLINT NOT NULL DEFAULT 10,
      max_ships_in_protected_space SMALLINT NOT NULL DEFAULT 1,
      truce_time_hours SMALLINT NOT NULL DEFAULT 0,
      is_automation_enabled BOOLEAN NOT NULL DEFAULT TRUE
    );
    ALTER TABLE edits ADD COLUMN IF NOT EXISTS starting_earth_colonists INTEGER NOT NULL DEFAULT 1000000;
    INSERT INTO edits (name) VALUES ('stock') ON CONFLICT (name) DO NOTHING;

    CREATE TABLE IF NOT EXISTS universes (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      seed INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      edit_id INTEGER REFERENCES edits(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS sectors (
      id SERIAL PRIMARY KEY,
      universe_id INTEGER NOT NULL REFERENCES universes(id) ON DELETE CASCADE,
      sector_number INTEGER NOT NULL,
      name VARCHAR(255),
      UNIQUE (universe_id, sector_number)
    );

    CREATE TABLE IF NOT EXISTS warps (
      from_sector_id INTEGER NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
      to_sector_id INTEGER NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
      PRIMARY KEY (from_sector_id, to_sector_id)
    );

    CREATE TABLE IF NOT EXISTS players (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255),
      user_id INTEGER NOT NULL REFERENCES users(id),
      universe_id INTEGER NOT NULL REFERENCES universes(id),
      current_sector_id INTEGER REFERENCES sectors(id),
      ship_id INTEGER,
      credits INTEGER NOT NULL DEFAULT 10000,
      reputation INTEGER NOT NULL DEFAULT 0,
      experience INTEGER NOT NULL DEFAULT 0,
      ship_destroyed_date TIMESTAMPTZ,
      last_login_at TIMESTAMPTZ,
      last_logout_at TIMESTAMPTZ,
      docked BOOLEAN NOT NULL DEFAULT FALSE,
      on_planet_id INTEGER DEFAULT NULL,
      turns INTEGER NOT NULL DEFAULT 0,
      last_turns_granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      is_knighted BOOLEAN NOT NULL DEFAULT FALSE,
      corporation_id INTEGER,
      current_menu_id INTEGER,
      UNIQUE (user_id, universe_id)
    );

    CREATE TABLE IF NOT EXISTS ports (
      id SERIAL PRIMARY KEY,
      sector_id INTEGER NOT NULL UNIQUE REFERENCES sectors(id) ON DELETE CASCADE,
      name VARCHAR(255),
      class INTEGER NOT NULL,
      fuel INTEGER NOT NULL DEFAULT 500,
      fuel_max INTEGER NOT NULL DEFAULT 1000,
      fuel_price INTEGER NOT NULL,
      fuel_buys INTEGER NOT NULL DEFAULT 0,
      organics INTEGER NOT NULL DEFAULT 500,
      org_max INTEGER NOT NULL DEFAULT 1000,
      org_price INTEGER NOT NULL,
      org_buys INTEGER NOT NULL DEFAULT 0,
      equipment INTEGER NOT NULL DEFAULT 500,
      equ_max INTEGER NOT NULL DEFAULT 1000,
      equ_price INTEGER NOT NULL,
      equ_buys INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS planets (
      id SERIAL PRIMARY KEY,
      sector_id INTEGER NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      type VARCHAR(255) NOT NULL DEFAULT 'Terran',
      drones SMALLINT NOT NULL DEFAULT 0,
      fuel SMALLINT NOT NULL DEFAULT 0,
      organics SMALLINT NOT NULL DEFAULT 0,
      equipment SMALLINT NOT NULL DEFAULT 0,
      colonists_fuel INTEGER NOT NULL DEFAULT 0,
      colonists_organics INTEGER NOT NULL DEFAULT 0,
      colonists_equipment INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS ship_types (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      make VARCHAR(255),
      sort_order SMALLINT NOT NULL DEFAULT 0,
      max_drones INTEGER NOT NULL DEFAULT 0,
      max_shields INTEGER NOT NULL DEFAULT 0,
      starting_holds INTEGER NOT NULL DEFAULT 5,
      max_holds INTEGER NOT NULL DEFAULT 20,
      odds_offensive REAL NOT NULL DEFAULT 1.0,
      odds_defensive REAL NOT NULL DEFAULT 1.0,
      has_pod BOOLEAN NOT NULL DEFAULT TRUE,
      can_land BOOLEAN NOT NULL DEFAULT TRUE,
      has_interdictor BOOLEAN NOT NULL DEFAULT FALSE,
      has_planetary_defense_bonus BOOLEAN NOT NULL DEFAULT FALSE,
      planetary_defense_odds REAL,
      speed SMALLINT NOT NULL DEFAULT 10,
      turns_per_warp INTEGER NOT NULL DEFAULT 2,
      cost_drive INTEGER NOT NULL DEFAULT 0,
      cost_computer INTEGER NOT NULL DEFAULT 0,
      cost_hull INTEGER NOT NULL DEFAULT 0,
      hold_cost INTEGER NOT NULL DEFAULT 0,
      max_drone_attack INTEGER NOT NULL DEFAULT 0,
      transporter_range INTEGER NOT NULL DEFAULT 0,
      has_tractor BOOLEAN NOT NULL DEFAULT FALSE,
      piloting_restriction VARCHAR(100),
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS ships (
      id SERIAL PRIMARY KEY,
      owner_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
      ship_type_id INTEGER NOT NULL REFERENCES ship_types(id),
      sector_id INTEGER REFERENCES sectors(id),
      drones INTEGER NOT NULL DEFAULT 0,
      shields INTEGER NOT NULL DEFAULT 0,
      holds INTEGER NOT NULL,
      turns_per_warp INTEGER NOT NULL DEFAULT 2,
      has_density_scanner BOOLEAN NOT NULL DEFAULT TRUE,
      fuel INTEGER NOT NULL DEFAULT 0,
      organics INTEGER NOT NULL DEFAULT 0,
      equipment INTEGER NOT NULL DEFAULT 0,
      colonists INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS visited_sectors (
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      sector_id INTEGER NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
      PRIMARY KEY (player_id, sector_id)
    );
  `);
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureSchema(client);

    // Ensure universe row exists, linked to stock edit
    await client.query(
      `INSERT INTO universes (id, name, edit_id)
       VALUES ($1, $2, (SELECT id FROM edits WHERE name = 'stock'))
       ON CONFLICT (id) DO UPDATE SET edit_id = COALESCE(universes.edit_id, (SELECT id FROM edits WHERE name = 'stock'))`,
      [universeId, `Universe ${universeId}`],
    );

    // Clear existing data for this universe (CASCADE from sectors handles warps, ports, etc.)
    await client.query('UPDATE players SET ship_id = NULL WHERE universe_id = $1', [universeId]);
    await client.query('DELETE FROM ships WHERE owner_id IN (SELECT id FROM players WHERE universe_id = $1)', [universeId]);
    await client.query('DELETE FROM players WHERE universe_id = $1', [universeId]);
    await client.query('DELETE FROM sectors WHERE universe_id = $1', [universeId]);

    // Import sectors and build sector_number → id map
    const sectorIdMap = new Map();
    const { rows: sectorRows } = readCSV(join(universeDir, 'sectors.csv'));
    for (const row of sectorRows) {
      const sectorNumber = parseInt(row[0], 10);
      const res = await client.query(
        'INSERT INTO sectors (universe_id, sector_number, name) VALUES ($1, $2, $3) RETURNING id',
        [universeId, sectorNumber, row[1]],
      );
      sectorIdMap.set(sectorNumber, res.rows[0].id);
    }

    // Import warps
    const { rows: warpRows } = readCSV(join(universeDir, 'warps.csv'));
    for (const row of warpRows) {
      const fromId = sectorIdMap.get(parseInt(row[0], 10));
      const toId = sectorIdMap.get(parseInt(row[1], 10));
      await client.query(
        'INSERT INTO warps (from_sector_id, to_sector_id) VALUES ($1, $2)',
        [fromId, toId],
      );
    }

    // Import ports
    const { rows: portRows } = readCSV(join(universeDir, 'ports.csv'));
    for (const row of portRows) {
      const sectorDbId = sectorIdMap.get(parseInt(row[0], 10));
      await client.query(
        `INSERT INTO ports
           (sector_id, class, fuel, fuel_price, organics, org_price, equipment, equ_price)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          sectorDbId,
          parseInt(row[1], 10), // class
          parseInt(row[2], 10), // fuel_qty
          parseInt(row[3], 10), // fuel_price
          parseInt(row[4], 10), // org_qty
          parseInt(row[5], 10), // org_price
          parseInt(row[6], 10), // equ_qty
          parseInt(row[7], 10), // equ_price
        ],
      );
    }

    // Import planets (if planets.csv exists)
    try {
      const { rows: planetRows } = readCSV(join(universeDir, 'planets.csv'));
      const seenSectors = new Set();
      for (const row of planetRows) {
        const sectorNumber = parseInt(row[0], 10);
        if (seenSectors.has(sectorNumber)) continue;
        seenSectors.add(sectorNumber);
        const sectorDbId = sectorIdMap.get(sectorNumber);
        await client.query(
          'INSERT INTO planets (sector_id, name, type) VALUES ($1, $2, $3)',
          [sectorDbId, row[1], row[2]],
        );
      }
    } catch {
      // planets.csv may not exist in older bigbang outputs
    }

    // Seed Class 0 port in Sector 1
    const sector1Id = sectorIdMap.get(1);
    await client.query(`
      INSERT INTO ports (sector_id, class, fuel, fuel_price, organics, org_price, equipment, equ_price)
      VALUES ($1, 0, 0, 0, 0, 0, 0, 0)
      ON CONFLICT (sector_id) DO UPDATE
      SET class = 0, fuel = 0, fuel_price = 0, organics = 0, org_price = 0, equipment = 0, equ_price = 0
    `, [sector1Id]);

    // Seed Earth in Sector 1 with starting colonists
    await client.query(`
      INSERT INTO planets (sector_id, name, type)
      VALUES ($1, 'Earth', 'Terran')
      ON CONFLICT DO NOTHING
    `, [sector1Id]);
    const earthColRes = await client.query(
      `SELECT COALESCE(e.starting_earth_colonists, 1000000) as col FROM edits e WHERE e.name = 'stock'`
    );
    const earthCol = earthColRes.rows[0]?.col ?? 1000000;
    await client.query(
      `UPDATE planets SET colonists_fuel = $1 WHERE sector_id = $2 AND name = 'Earth'`,
      [earthCol, sector1Id]
    );

    // Seed Class 9 port at Starbase
    const starbaseRes = await client.query(
      `SELECT id FROM sectors WHERE name = 'Starbase' AND universe_id = $1`,
      [universeId],
    );
    if (starbaseRes.rows.length > 0) {
      await client.query(`
        INSERT INTO ports (sector_id, class, fuel, fuel_price, organics, org_price, equipment, equ_price)
        VALUES ($1, 9, 0, 0, 0, 0, 0, 0)
        ON CONFLICT (sector_id) DO UPDATE
        SET class = 9, fuel = 0, fuel_price = 0, organics = 0, org_price = 0, equipment = 0, equ_price = 0
      `, [starbaseRes.rows[0].id]);
    }

    await client.query('COMMIT');
    console.log(
      `Import complete: ${sectorRows.length} sectors, ${warpRows.length} warps, ${portRows.length} ports (universe_id=${universeId}).`,
    );
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Import failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();

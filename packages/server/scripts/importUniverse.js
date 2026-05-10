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

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pool } from '../dist/db/pool.js';
import { DEFAULT_TOPOLOGY } from '../dist/bigbang/types.js';
import { connectDB } from '../dist/db/schema.js';

const args = process.argv.slice(2);
const universeDir = args.find(a => !a.startsWith('--'));
const force = args.includes('--force');

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


async function main() {
  await connectDB();

  let topology = DEFAULT_TOPOLOGY;
  const manifestPath = join(universeDir, 'manifest.json');
  if (existsSync(manifestPath)) {
    try {
      const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (m.topology === 'random' || m.topology === 'proximal') topology = m.topology;
    } catch (err) {
      console.warn(`Warning: failed to parse ${manifestPath}: ${err.message}`);
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Ensure universe row exists, linked to the stock template. Sets topology
    // from the bigbang manifest on insert; preserves it on conflict unless
    // still default. Settings are snapshotted into universe_settings just
    // below so the universe gets its own frozen copy.
    await client.query(
      `INSERT INTO universes (id, name, template_id, topology)
       VALUES ($1, $2, (SELECT id FROM edit_templates WHERE name = 'stock'), $3)
       ON CONFLICT (id) DO UPDATE SET
         template_id = COALESCE(universes.template_id, (SELECT id FROM edit_templates WHERE name = 'stock')),
         topology = EXCLUDED.topology`,
      [universeId, `Universe ${universeId}`, topology],
    );

    // Snapshot the stock template into universe_settings (no-op on re-run).
    await client.query(
      `INSERT INTO universe_settings (
          universe_id, max_planets_per_sector, planet_collision_likelihood,
          planet_collision_min_hours, planet_collision_max_hours,
          turns_per_day, starting_turns, max_turns, starting_ship,
          starting_drones, starting_credits, starting_port_density,
          max_port_density, port_production_rate, port_memory_hours,
          max_players, max_age_days, max_planets, turn_delay,
          is_speed_warp_delay_on, photons_allowed, photon_blast_time_seconds,
          planet_spawn_density, max_ships_allowed, max_corp_size,
          max_ships_in_protected_space, truce_time_hours, is_automation_enabled,
          starting_shields, starting_earth_colonists
       )
       SELECT $1, max_planets_per_sector, planet_collision_likelihood,
              planet_collision_min_hours, planet_collision_max_hours,
              turns_per_day, starting_turns, max_turns, starting_ship,
              starting_drones, starting_credits, starting_port_density,
              max_port_density, port_production_rate, port_memory_hours,
              max_players, max_age_days, max_planets, turn_delay,
              is_speed_warp_delay_on, photons_allowed, photon_blast_time_seconds,
              planet_spawn_density, max_ships_allowed, max_corp_size,
              max_ships_in_protected_space, truce_time_hours, is_automation_enabled,
              starting_shields, starting_earth_colonists
       FROM edit_templates WHERE name = 'stock'
       ON CONFLICT (universe_id) DO NOTHING`,
      [universeId],
    );

    // Bump the SERIAL sequence past any explicitly-inserted id so subsequent
    // auto-id inserts (e.g. admin API generate) don't collide.
    await client.query(
      `SELECT setval('universes_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM universes), 1))`,
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
      const x = row[2] === undefined || row[2] === '' ? null : Number(row[2]);
      const y = row[3] === undefined || row[3] === '' ? null : Number(row[3]);
      const res = await client.query(
        'INSERT INTO sectors (universe_id, sector_number, name, x, y) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [universeId, sectorNumber, row[1], x, y],
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
      const fuelQty = parseInt(row[2], 10);
      const orgQty = parseInt(row[4], 10);
      const equQty = parseInt(row[6], 10);
      await client.query(
        `INSERT INTO ports
           (sector_id, class, fuel, fuel_max, fuel_price, organics, org_max, org_price, equipment, equ_max, equ_price)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          sectorDbId,
          parseInt(row[1], 10), // class
          fuelQty,
          fuelQty,              // fuel_max
          parseInt(row[3], 10), // fuel_price
          orgQty,
          orgQty,               // org_max
          parseInt(row[5], 10), // org_price
          equQty,
          equQty,               // equ_max
          parseInt(row[7], 10), // equ_price
        ],
      );
    }

    // Import planets. The CSV always contains Earth at sector 1 (emitted by
    // generateUniverse) plus any random scatter from planetDensity > 0.
    try {
      const { rows: planetRows } = readCSV(join(universeDir, 'planets.csv'));
      for (const row of planetRows) {
        const sectorNumber = parseInt(row[0], 10);
        const sectorDbId = sectorIdMap.get(sectorNumber);
        if (sectorDbId === undefined) continue;
        await client.query(
          `INSERT INTO planets (sector_id, name, type) VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
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

    // Earth is now imported via planets.csv (above); just set its starting
    // colonists from universe_settings.
    const earthColRes = await client.query(
      `SELECT starting_earth_colonists AS col FROM universe_settings WHERE universe_id = $1`,
      [universeId]
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

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
import { pool } from '../dist/db/pool.js';
import { connectDB } from '../dist/db/schema.js';

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


async function main() {
  await connectDB();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

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

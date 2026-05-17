#!/usr/bin/env node
/**
 * importUniverse.js
 * Imports a twnr-bigbang output directory into the server's PostgreSQL database.
 *
 * Usage: node scripts/importUniverse.js <bigbang-output-dir> [--force] [--universe-id <id>]

 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { universeConfig } from '@twnr/shared';
import { pool } from '../dist/db/pool.js';
import { connectDB } from '../dist/db/schema.js';
import { snapshotTemplateForUniverse } from '../dist/db/queries/universe.js';

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

  let topology = universeConfig.topology;
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
    await client.query(
      `INSERT INTO universes (id, name, template_id, topology)
       VALUES ($1, $2, (SELECT id FROM universe_template WHERE name = 'stock'), $3)
       ON CONFLICT (id) DO UPDATE SET
         template_id = COALESCE(universes.template_id, (SELECT id FROM universe_template WHERE name = 'stock')),
         topology = EXCLUDED.topology`,
      [universeId, `Universe ${universeId}`, topology],
    );

    await snapshotTemplateForUniverse(universeId, 'stock', client);

    // Bump the SERIAL sequence past any explicitly-inserted id so subsequent
    // auto-id inserts don't collide.
    await client.query(
      `SELECT setval('universes_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM universes), 1))`,
    );

    // Clear existing data for this universe (CASCADE from sectors handles warps, ports, etc.)
    await client.query('UPDATE players SET ship_id = NULL WHERE universe_id = $1', [universeId]);
    await client.query('DELETE FROM ships WHERE owner_player_id IN (SELECT id FROM players WHERE universe_id = $1)', [universeId]);
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
    // CSV columns: sector,class,
    //   fuel_qty,fuel_max,fuel_prod,fuel_mcic,
    //   org_qty,org_max,org_prod,org_mcic,
    //   equ_qty,equ_max,equ_prod,equ_mcic
    const { rows: portRows } = readCSV(join(universeDir, 'ports.csv'));
    for (const row of portRows) {
      const sectorDbId = sectorIdMap.get(parseInt(row[0], 10));
      await client.query(
        `INSERT INTO ports
           (sector_id, name, class,
            fuel, fuel_max, fuel_prod, fuel_mcic,
            organics, org_max, org_prod, org_mcic,
            equipment, equ_max, equ_prod, equ_mcic)
         VALUES ($1, (SELECT 'Port ' || sector_number FROM sectors WHERE id = $1),
                 $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          sectorDbId,
          parseInt(row[1], 10),  // class
          parseInt(row[2], 10),  // fuel_qty
          parseInt(row[3], 10),  // fuel_max
          parseInt(row[4], 10),  // fuel_prod
          parseInt(row[5], 10),  // fuel_mcic
          parseInt(row[6], 10),  // org_qty
          parseInt(row[7], 10),  // org_max
          parseInt(row[8], 10),  // org_prod
          parseInt(row[9], 10),  // org_mcic
          parseInt(row[10], 10), // equ_qty
          parseInt(row[11], 10), // equ_max
          parseInt(row[12], 10), // equ_prod
          parseInt(row[13], 10), // equ_mcic
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
          `INSERT INTO planets (sector_id, universe_id, name, type)
           SELECT s.id, s.universe_id, $2, $3 FROM sectors s WHERE s.id = $1
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
      INSERT INTO ports (sector_id, name, class,
                         fuel, fuel_max, fuel_prod, fuel_mcic,
                         organics, org_max, org_prod, org_mcic,
                         equipment, equ_max, equ_prod, equ_mcic)
      VALUES ($1, (SELECT 'Port ' || sector_number FROM sectors WHERE id = $1),
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
      ON CONFLICT (sector_id) DO UPDATE
      SET class = 0,
          fuel = 0, fuel_max = 0, fuel_prod = 0, fuel_mcic = 0,
          organics = 0, org_max = 0, org_prod = 0, org_mcic = 0,
          equipment = 0, equ_max = 0, equ_prod = 0, equ_mcic = 0
    `, [sector1Id]);

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
        INSERT INTO ports (sector_id, name, class,
                           fuel, fuel_max, fuel_prod, fuel_mcic,
                           organics, org_max, org_prod, org_mcic,
                           equipment, equ_max, equ_prod, equ_mcic)
        VALUES ($1, (SELECT 'Port ' || sector_number FROM sectors WHERE id = $1),
                9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
        ON CONFLICT (sector_id) DO UPDATE
        SET class = 9,
            fuel = 0, fuel_max = 0, fuel_prod = 0, fuel_mcic = 0,
            organics = 0, org_max = 0, org_prod = 0, org_mcic = 0,
            equipment = 0, equ_max = 0, equ_prod = 0, equ_mcic = 0
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

#!/usr/bin/env node
/**
 * importUniverse.js
 * Imports a twnr-bigbang output directory into the server's PostgreSQL database.
 *
 * Usage: node scripts/importUniverse.js <bigbang-output-dir>
 *
 * The server schema is created if it doesn't already exist. Existing universe
 * data (sectors, warps, ports, players, ship_cargo) is wiped before import.
 * Run this while the server is not running to avoid state conflicts.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const { Pool } = pg;

const universeDir = process.argv[2];
if (!universeDir) {
  console.error('Usage: node scripts/importUniverse.js <bigbang-output-dir>');
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
  user: process.env.PGUSER || 'twnr_user',
  password: process.env.PGPASSWORD || 'twnr_pass',
});

async function ensureSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS sectors (
      id INTEGER PRIMARY KEY,
      name VARCHAR(255)
    );
    ALTER TABLE sectors ADD COLUMN IF NOT EXISTS name VARCHAR(255);

    CREATE TABLE IF NOT EXISTS warps (
      sector_from INTEGER NOT NULL REFERENCES sectors(id),
      sector_to   INTEGER NOT NULL REFERENCES sectors(id),
      PRIMARY KEY (sector_from, sector_to)
    );

    CREATE TABLE IF NOT EXISTS players (
      id             SERIAL PRIMARY KEY,
      name           VARCHAR(255),
      current_sector INTEGER REFERENCES sectors(id)
    );

    CREATE TABLE IF NOT EXISTS ports (
      id        SERIAL PRIMARY KEY,
      sector_id INTEGER NOT NULL UNIQUE REFERENCES sectors(id),
      fuel      INTEGER NOT NULL DEFAULT 500,
      organics  INTEGER NOT NULL DEFAULT 500,
      equipment INTEGER NOT NULL DEFAULT 500
    );

    CREATE TABLE IF NOT EXISTS ship_cargo (
      player_id INTEGER PRIMARY KEY,
      fuel      INTEGER NOT NULL DEFAULT 0,
      organics  INTEGER NOT NULL DEFAULT 0,
      equipment INTEGER NOT NULL DEFAULT 0,
      credits   INTEGER NOT NULL DEFAULT 10000
    );
  `);
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureSchema(client);

    // Clear existing universe data (CASCADE handles dependent tables)
    await client.query('DELETE FROM ship_cargo');
    await client.query('DELETE FROM players');
    await client.query('DELETE FROM ports');
    await client.query('DELETE FROM warps');
    await client.query('DELETE FROM sectors');

    // Import sectors (bigbang columns: id, name)
    const { rows: sectorRows } = readCSV(join(universeDir, 'sectors.csv'));
    for (const row of sectorRows) {
      await client.query(
        'INSERT INTO sectors (id, name) VALUES ($1, $2)',
        [parseInt(row[0], 10), row[1]],
      );
    }

    // Import warps (bigbang columns: sector_from, sector_to)
    const { rows: warpRows } = readCSV(join(universeDir, 'warps.csv'));
    for (const row of warpRows) {
      await client.query(
        'INSERT INTO warps (sector_from, sector_to) VALUES ($1, $2)',
        [parseInt(row[0], 10), parseInt(row[1], 10)],
      );
    }

    // Import ports
    // bigbang columns: sector, class, fuel_qty, fuel_price, org_qty, org_price, equ_qty, equ_price
    // server schema:   sector_id, fuel, organics, equipment
    const { rows: portRows } = readCSV(join(universeDir, 'ports.csv'));
    for (const row of portRows) {
      await client.query(
        'INSERT INTO ports (sector_id, fuel, organics, equipment) VALUES ($1, $2, $3, $4)',
        [
          parseInt(row[0], 10), // sector
          parseInt(row[2], 10), // fuel_qty
          parseInt(row[4], 10), // org_qty
          parseInt(row[6], 10), // equ_qty
        ],
      );
    }

    await client.query('COMMIT');
    console.log(
      `Import complete: ${sectorRows.length} sectors, ${warpRows.length} warps, ${portRows.length} ports.`,
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

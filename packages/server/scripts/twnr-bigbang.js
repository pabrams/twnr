#!/usr/bin/env node

/**
 * Thin CLI wrapper around `generateUniverse()`. Parses --flags, calls the
 * shared generator, writes the result to CSV. All actual generation logic
 * (sectors, warps, ports, planets, layout, hub-forcing) lives in
 * `packages/server/src/bigbang/generate.ts` so the CLI and the in-process
 * admin path can't drift apart.
 */

import fs from 'node:fs';
import path from 'node:path';
import { generateUniverse, defaultBigBangOptions } from '../dist/bigbang/index.js';
import { universeConfig } from '@twnr/shared';

const args = process.argv.slice(2);
let outDir = null;
let sectors = 25000;
let portDensity = universeConfig.portSpawnDensity;
let planetDensity = 0;
let twoWayPct = universeConfig.twoWayPct;
let seed = 42;
let warpDist = [0, ...universeConfig.warpDist];
let topology = universeConfig.topology;

for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--warp-dist') {
        if (i + 1 >= args.length) {
            console.error('Error: --warp-dist requires a value');
            process.exit(1);
        }
        const parts = args[++i].split(',').map(Number);
        if (parts.length !== 6 || parts.some(isNaN) || parts.some(p => p < 0)) {
            console.error('Error: --warp-dist must be 6 comma-separated non-negative numbers (degrees 1-6)');
            process.exit(1);
        }
        if (parts.reduce((a, b) => a + b, 0) <= 0) {
            console.error('Error: --warp-dist values must sum to a positive number');
            process.exit(1);
        }
        warpDist = [0, ...parts];
    } else if (arg === '--topology') {
        if (i + 1 >= args.length) {
            console.error('Error: --topology requires a value');
            process.exit(1);
        }
        const val = args[++i];
        if (val !== 'random' && val !== 'proximal') {
            console.error("Error: --topology must be 'random' or 'proximal'");
            process.exit(1);
        }
        topology = val;
    } else if (['--sectors', '--port-density', '--planet-density', '--two-way-pct', '--seed'].includes(arg)) {
        if (i + 1 >= args.length) {
            console.error(`Error: ${arg} requires a value`);
            process.exit(1);
        }
        const valStr = args[++i];
        const val = Number(valStr);
        if (isNaN(val)) {
            console.error(`Error: ${arg} must be a valid number`);
            process.exit(1);
        }
        if (arg === '--sectors') sectors = Math.floor(val);
        else if (arg === '--port-density') portDensity = val;
        else if (arg === '--planet-density') planetDensity = val;
        else if (arg === '--two-way-pct') twoWayPct = val;
        else if (arg === '--seed') seed = Math.floor(val);
    } else if (!arg.startsWith('--')) {
        if (!outDir) {
            outDir = arg;
        } else {
            console.error("Error: Multiple output directories specified.");
            process.exit(1);
        }
    } else {
        console.error(`Error: Unknown option ${arg}`);
        process.exit(1);
    }
}

if (!outDir) {
    console.error("Usage: node twnr-bigbang.js <output-dir> [--sectors N] [OPTIONS]");
    console.error("Options:");
    console.error("  --sectors N             Number of sectors");
    console.error("  --port-density N        Port density 1-100");
    console.error("  --planet-density N      Planet density 0-100");
    console.error("  --two-way-pct N         Two-way warp percentage 0-100");
    console.error("  --warp-dist D1,...,D6   Warp-out degree distribution for 1-6");
    console.error("  --topology MODE         'proximal' (default) or 'random'");
    console.error("  --seed N                Random seed (default: random)");
    process.exit(1);
}
if (sectors < 20 || sectors > 25000) {
    console.error("Error: --sectors must be between 20 and 25000");
    process.exit(1);
}
if (portDensity < 1 || portDensity > 100) {
    console.error("Error: --port-density must be between 1 and 100");
    process.exit(1);
}
if (planetDensity < 0 || planetDensity > 100) {
    console.error("Error: --planet-density must be between 0 and 100");
    process.exit(1);
}
if (twoWayPct < 0 || twoWayPct > 100) {
    console.error("Error: --two-way-pct must be between 0 and 100");
    process.exit(1);
}

if (fs.existsSync(outDir)) {
    const stats = fs.statSync(outDir);
    if (!stats.isDirectory()) {
        console.error(`Error: ${outDir} exists and is not a directory`);
        process.exit(1);
    }
    const files = fs.readdirSync(outDir);
    if (files.length > 0) {
        console.error(`Error: ${outDir} exists and is not empty`);
        process.exit(1);
    }
} else {
    fs.mkdirSync(outDir, { recursive: true });
}

const result = generateUniverse(defaultBigBangOptions({
    sectors,
    seed,
    portDensity,
    planetDensity,
    twoWayPct,
    warpDist,
    topology,
}));

// Stats summary on stderr.
{
    const N = result.sectors.length;
    const outMap = new Map();
    for (const w of result.warps) outMap.set(w.from, (outMap.get(w.from) || 0) + 1);
    const degDist = new Array(7).fill(0);
    for (const [, c] of outMap) if (c >= 1 && c <= 6) degDist[c]++;
    const warpSet = new Set(result.warps.map(w => `${w.from},${w.to}`));
    let bi = 0;
    for (const w of result.warps) if (warpSet.has(`${w.to},${w.from}`)) bi++;
    console.error(`Topology: ${result.topology}, Sectors: ${N}, Warps: ${result.warps.length}, Two-way: ${(bi / result.warps.length * 100).toFixed(1)}%`);
    console.error(`Degree dist: ${degDist.slice(1).map((c, i) => `${i + 1}=${c}`).join(', ')}`);
}

function toCSVLine(arr) {
    return arr.map(v => {
        if (v === null || v === undefined) return '';
        const str = String(v);
        if (str.includes(',')) return `"${str}"`;
        return str;
    }).join(',');
}

const sectorsRows = result.sectors.map(s => toCSVLine([s.id, s.name, s.x, s.y]));
fs.writeFileSync(path.join(outDir, 'sectors.csv'), 'id,name,x,y\n' + sectorsRows.join('\n') + '\n');

const warpsRows = result.warps.map(w => toCSVLine([w.from, w.to]));
fs.writeFileSync(path.join(outDir, 'warps.csv'), 'from_sector_id,to_sector_id\n' + warpsRows.join('\n') + '\n');

const portsRows = result.ports.map(p => toCSVLine([
    p.sector, p.class,
    p.fuel_qty, p.fuel_price,
    p.org_qty, p.org_price,
    p.equ_qty, p.equ_price,
]));
fs.writeFileSync(path.join(outDir, 'ports.csv'), 'sector,class,fuel_qty,fuel_price,org_qty,org_price,equ_qty,equ_price\n' + portsRows.join('\n') + '\n');

const planetsRows = result.planets.map(p => toCSVLine([p.sector, p.name, p.type]));
fs.writeFileSync(path.join(outDir, 'planets.csv'), 'sector,planet_name,planet_type\n' + planetsRows.join('\n') + '\n');

const manifest = { topology: result.topology, seed: result.seed, sectorCount: result.sectors.length };
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

// Standalone import script — used by tests and as a quick way to load the
// CSV bundle into a fresh DB without running the server.
const sql = `BEGIN;

CREATE TABLE sectors (
    id INTEGER PRIMARY KEY,
    name VARCHAR(255),
    x DOUBLE PRECISION,
    y DOUBLE PRECISION
);

CREATE TABLE warps (
    from_sector_id INTEGER NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
    to_sector_id INTEGER NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
    PRIMARY KEY (from_sector_id, to_sector_id)
);

CREATE TABLE ports (
    sector INTEGER PRIMARY KEY,
    class INTEGER,
    fuel_qty INTEGER,
    fuel_price INTEGER,
    org_qty INTEGER,
    org_price INTEGER,
    equ_qty INTEGER,
    equ_price INTEGER
);

CREATE TABLE planets (
    sector INTEGER,
    planet_name VARCHAR(255),
    planet_type VARCHAR(255)
);

\\copy sectors FROM 'sectors.csv' WITH (FORMAT csv, HEADER true)
\\copy warps FROM 'warps.csv' WITH (FORMAT csv, HEADER true)
\\copy ports FROM 'ports.csv' WITH (FORMAT csv, HEADER true)
\\copy planets FROM 'planets.csv' WITH (FORMAT csv, HEADER true)

COMMIT;
`;
fs.writeFileSync(path.join(outDir, 'import.sql'), sql);

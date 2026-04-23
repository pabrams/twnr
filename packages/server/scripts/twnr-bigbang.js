#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { generateGraph } from '../dist/bigbang/graph.js';
import { generateProximalGraph } from '../dist/bigbang/graph-proximal.js';
import { scatterPositions } from '../dist/bigbang/positions.js';
import { mulberry32 } from '../dist/bigbang/prng.js';
import { DEFAULT_WARP_DIST } from '../dist/bigbang/types.js';

const args = process.argv.slice(2);
let outDir = null;
let sectors = 25000;
let portDensity = 80;
let planetDensity = 0;
let twoWayPct = 95;
let seed = 42;
let warpDist = [...DEFAULT_WARP_DIST];
let topology = 'random';

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
    console.error("  --topology MODE         'random' (default) or 'proximal'");
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
if (seed === null) {
    seed = Math.floor(Math.random() * 2147483647);
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

const rng = mulberry32(seed);

function randomInt(min, max) {
    return Math.floor(rng() * (max - min + 1)) + min;
}

const N = sectors;
const sectorNames = new Array(N + 1).fill("");
sectorNames[1] = "Federation Space";
const starbaseId = randomInt(2, N);
sectorNames[starbaseId] = "Starbase";

const positions = topology === 'proximal' ? scatterPositions(N, rng) : null;

const warps = positions
    ? generateProximalGraph(N, twoWayPct, rng, positions, warpDist)
    : generateGraph(N, twoWayPct, rng, warpDist);

// Print generation stats
{
    const outMap = new Map();
    for (const w of warps) outMap.set(w.from, (outMap.get(w.from) || 0) + 1);
    const degDist = new Array(7).fill(0);
    for (const [, c] of outMap) if (c >= 1 && c <= 6) degDist[c]++;
    const warpSet = new Set(warps.map(w => `${w.from},${w.to}`));
    let bi = 0;
    for (const w of warps) if (warpSet.has(`${w.to},${w.from}`)) bi++;
    console.error(`Topology: ${topology}, Sectors: ${N}, Warps: ${warps.length}, Two-way: ${(bi / warps.length * 100).toFixed(1)}%`);
    console.error(`Degree dist: ${degDist.slice(1).map((c, i) => `${i + 1}=${c}`).join(', ')}`);
}

const portClasses = {
    1: ['B', 'B', 'S'],
    2: ['B', 'S', 'B'],
    3: ['S', 'B', 'B'],
    4: ['S', 'S', 'B'],
    5: ['B', 'S', 'S'],
    6: ['S', 'B', 'S'],
    7: ['S', 'S', 'S'],
    8: ['B', 'B', 'B']
};

const totalPortsTarget = Math.max(1, Math.round(N * portDensity / 100));
const ports = [];

function generatePort(sectorId, portClass) {
    const pClassStr = portClasses[portClass];
    const generateCommodity = (type) => {
        const qty = randomInt(0, 5000);
        const price = type === 'S' ? randomInt(10, 50) : randomInt(51, 100);
        return {qty, price};
    };
    const fuel = generateCommodity(pClassStr[0]);
    const org = generateCommodity(pClassStr[1]);
    const equ = generateCommodity(pClassStr[2]);
    return {
        sector: sectorId,
        class: portClass,
        fuel_qty: fuel.qty, fuel_price: fuel.price,
        org_qty: org.qty, org_price: org.price,
        equ_qty: equ.qty, equ_price: equ.price
    };
}

ports.push(generatePort(starbaseId, 8));

let numOtherPorts = totalPortsTarget - 1;
if (numOtherPorts > N - 2) {
    numOtherPorts = N - 2;
}

let availableSectorsForPorts = [];
for (let i = 2; i <= N; i++) {
    if (i !== starbaseId) {
        availableSectorsForPorts.push(i);
    }
}
for (let i = availableSectorsForPorts.length - 1; i > 0; i--) {
    let j = Math.floor(rng() * (i + 1));
    [availableSectorsForPorts[i], availableSectorsForPorts[j]] = [availableSectorsForPorts[j], availableSectorsForPorts[i]];
}

let classPool = [];
function getNextClass() {
    if (classPool.length === 0) {
        classPool = [1, 2, 3, 4, 5, 6, 7, 8];
        for (let i = classPool.length - 1; i > 0; i--) {
            let j = Math.floor(rng() * (i + 1));
            [classPool[i], classPool[j]] = [classPool[j], classPool[i]];
        }
    }
    return classPool.pop();
}

for (let i = 0; i < numOtherPorts; i++) {
    let sectorId = availableSectorsForPorts[i];
    let pClass = getNextClass();
    ports.push(generatePort(sectorId, pClass));
}

ports.sort((a, b) => a.sector - b.sector);

let totalPlanetSectors = Math.round(N * planetDensity / 100);
if (totalPlanetSectors > N - 1) {
    totalPlanetSectors = N - 1;
}

let availableSectorsForPlanets = [];
for (let i = 2; i <= N; i++) {
    availableSectorsForPlanets.push(i);
}
for (let i = availableSectorsForPlanets.length - 1; i > 0; i--) {
    let j = Math.floor(rng() * (i + 1));
    [availableSectorsForPlanets[i], availableSectorsForPlanets[j]] = [availableSectorsForPlanets[j], availableSectorsForPlanets[i]];
}

const planetTypesPool = ["Terran", "Volcanic", "Glacial", "Gas Giant", "Mountainous"];
let pTypePool = [];
function getNextPlanetType() {
    if (pTypePool.length === 0) {
        pTypePool = [...planetTypesPool];
        for (let i = pTypePool.length - 1; i > 0; i--) {
            let j = Math.floor(rng() * (i + 1));
            [pTypePool[i], pTypePool[j]] = [pTypePool[j], pTypePool[i]];
        }
    }
    return pTypePool.pop();
}

const planets = [];
for (let i = 0; i < totalPlanetSectors; i++) {
    let sectorId = availableSectorsForPlanets[i];
    let numPlanets = randomInt(1, 3);
    for (let p = 1; p <= numPlanets; p++) {
        let pType = getNextPlanetType();
        let pName = `${pType}-${sectorId}-${p}`;
        planets.push({
            sector: sectorId,
            planet_name: pName,
            planet_type: pType
        });
    }
}
planets.sort((a, b) => a.sector !== b.sector ? a.sector - b.sector : a.planet_name.localeCompare(b.planet_name));

function toCSVLine(arr) {
    return arr.map(v => {
        if (v === null || v === undefined) return '';
        let str = String(v);
        if (str.includes(',')) return `"${str}"`;
        return str;
    }).join(',');
}

const sectorsRows = [];
for (let i = 1; i <= N; i++) {
    const pos = positions ? positions[i - 1] : null;
    const x = pos ? pos.x : null;
    const y = pos ? pos.y : null;
    sectorsRows.push(toCSVLine([i, sectorNames[i], x, y]));
}
fs.writeFileSync(path.join(outDir, 'sectors.csv'), 'id,name,x,y\n' + sectorsRows.join('\n') + '\n');

const warpsRows = warps.map(w => toCSVLine([w.from, w.to]));
fs.writeFileSync(path.join(outDir, 'warps.csv'), 'from_sector_id,to_sector_id\n' + warpsRows.join('\n') + '\n');

const portsRows = ports.map(p => toCSVLine([
    p.sector, p.class,
    p.fuel_qty, p.fuel_price,
    p.org_qty, p.org_price,
    p.equ_qty, p.equ_price
]));
fs.writeFileSync(path.join(outDir, 'ports.csv'), 'sector,class,fuel_qty,fuel_price,org_qty,org_price,equ_qty,equ_price\n' + portsRows.join('\n') + '\n');

const planetsRows = planets.map(p => toCSVLine([p.sector, p.planet_name, p.planet_type]));
fs.writeFileSync(path.join(outDir, 'planets.csv'), 'sector,planet_name,planet_type\n' + planetsRows.join('\n') + '\n');

const manifest = { topology, seed, sectorCount: N };
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

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

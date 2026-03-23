#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
let outDir = null;
let sectors = null;
let portDensity = 50;
let planetDensity = 5;
let twoWayPct = 90;
let seed = null;

for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (['--sectors', '--port-density', '--planet-density', '--two-way-pct', '--seed'].includes(arg)) {
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

if (!outDir || sectors === null) {
    console.error("Usage: node twnr-bigbang.js <output-dir> --sectors N [OPTIONS]");
    process.exit(1);
}
if (sectors < 20 || sectors > 5000) {
    console.error("Error: --sectors must be between 20 and 5000");
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

function mulberry32(a) {
    return function() {
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}
const rng = mulberry32(seed);

function randomInt(min, max) {
    return Math.floor(rng() * (max - min + 1)) + min;
}

const N = sectors;
const sectorNames = new Array(N + 1).fill("");
sectorNames[1] = "Federation Space";
const stardockId = randomInt(2, N);
sectorNames[stardockId] = "Stardock";

function generateGraph(N, T, rng) {
    let bestW = -1, bestE_bi = -1, bestE_uni = -1, minDiff = 100;
    let minW = Math.max(N, 20);
    let maxW = N * 4;
    
    for (let w = minW; w <= maxW; w++) {
        let targetBi = w * T / 100;
        let e_bi = Math.round(targetBi / 2);
        let e_uni = w - 2 * e_bi;
        
        if (e_bi + e_uni < N) continue;
        if (e_bi < 0 || e_uni < 0) continue;
        
        let pct = (2 * e_bi / w) * 100;
        let diff = Math.abs(pct - T);
        if (diff < minDiff) {
            minDiff = diff;
            bestW = w;
            bestE_bi = e_bi;
            bestE_uni = e_uni;
        }
    }

    while (true) {
        let outDegree = new Int32Array(N + 1);
        let inDegree = new Int32Array(N + 1);
        let edges = new Set();
        
        function addEdge(u, v) {
            edges.add(`${u},${v}`);
            outDegree[u]++;
            inDegree[v]++;
        }
        function canAddPair(u, v) {
            if (u === v) return false;
            if (edges.has(`${u},${v}`) || edges.has(`${v},${u}`)) return false;
            if (outDegree[u] >= 6 || inDegree[v] >= 6) return false;
            if (outDegree[v] >= 6 || inDegree[u] >= 6) return false;
            return true;
        }
        function canAddSingle(u, v) {
            if (u === v) return false;
            if (edges.has(`${u},${v}`) || edges.has(`${v},${u}`)) return false;
            if (outDegree[u] >= 6 || inDegree[v] >= 6) return false;
            return true;
        }

        let nodes = Array.from({length: N}, (_, i) => i + 1);
        for (let i = nodes.length - 1; i > 0; i--) {
            let j = Math.floor(rng() * (i + 1));
            [nodes[i], nodes[j]] = [nodes[j], nodes[i]];
        }

        let K = Math.max(0, N - bestE_uni);
        let cycleEdges = [];
        for (let i = 0; i < N; i++) {
            cycleEdges.push([nodes[i], nodes[(i + 1) % N]]);
        }
        
        for (let i = cycleEdges.length - 1; i > 0; i--) {
            let j = Math.floor(rng() * (i + 1));
            [cycleEdges[i], cycleEdges[j]] = [cycleEdges[j], cycleEdges[i]];
        }

        let K_added = 0;
        let single_added = 0;
        for (let i = 0; i < N; i++) {
            let [u, v] = cycleEdges[i];
            if (i < K) {
                addEdge(u, v);
                addEdge(v, u);
                K_added++;
            } else {
                addEdge(u, v);
                single_added++;
            }
        }

        let pairs_needed = bestE_bi - K_added;
        let singles_needed = bestE_uni - single_added;

        let attempts = 0;
        let success = true;

        while (pairs_needed > 0) {
            if (attempts++ > 20000) { success = false; break; }
            let u = Math.floor(rng() * N) + 1;
            let v = Math.floor(rng() * N) + 1;
            if (canAddPair(u, v)) {
                addEdge(u, v);
                addEdge(v, u);
                pairs_needed--;
                attempts = 0;
            }
        }
        if (!success) continue;

        attempts = 0;
        while (singles_needed > 0) {
            if (attempts++ > 20000) { success = false; break; }
            let u = Math.floor(rng() * N) + 1;
            let v = Math.floor(rng() * N) + 1;
            if (canAddSingle(u, v)) {
                addEdge(u, v);
                singles_needed--;
                attempts = 0;
            }
        }
        if (!success) continue;
        
        let valid = true;
        for(let i=1; i<=N; i++) {
            if (outDegree[i] < 1 || outDegree[i] > 6 || inDegree[i] < 1 || inDegree[i] > 6) {
                valid = false; break;
            }
        }
        if (!valid) continue;

        let totalWarps = edges.size;
        let biWarps = 0;
        for (let e of edges) {
            let [u, v] = e.split(',');
            if (edges.has(`${v},${u}`)) biWarps++;
        }
        let actualPct = (biWarps / totalWarps) * 100;
        if (Math.abs(actualPct - T) > 1.0001) {
            continue;
        }

        let result = [];
        for (let e of edges) {
            let parts = e.split(',');
            result.push({from: parseInt(parts[0], 10), to: parseInt(parts[1], 10)});
        }
        result.sort((a, b) => {
            if (a.from !== b.from) return a.from - b.from;
            return a.to - b.to;
        });
        return result;
    }
}

const warps = generateGraph(N, twoWayPct, rng);

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

ports.push(generatePort(stardockId, 8));

let numOtherPorts = totalPortsTarget - 1;
if (numOtherPorts > N - 2) {
    numOtherPorts = N - 2;
}

let availableSectorsForPorts = [];
for (let i = 2; i <= N; i++) {
    if (i !== stardockId) {
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

const planetTypesPool = ["Earth-like", "Volcanic", "Glacial", "Gaseous", "Mountainous"];
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
        let str = String(v);
        if (str.includes(',')) return `"${str}"`;
        return str;
    }).join(',');
}

const sectorsRows = [];
for (let i = 1; i <= N; i++) {
    sectorsRows.push(toCSVLine([i, sectorNames[i]]));
}
fs.writeFileSync(path.join(outDir, 'sectors.csv'), 'id,name\n' + sectorsRows.join('\n') + '\n');

const warpsRows = warps.map(w => toCSVLine([w.from, w.to]));
fs.writeFileSync(path.join(outDir, 'warps.csv'), 'sector_from,sector_to\n' + warpsRows.join('\n') + '\n');

const portsRows = ports.map(p => toCSVLine([
    p.sector, p.class, 
    p.fuel_qty, p.fuel_price, 
    p.org_qty, p.org_price, 
    p.equ_qty, p.equ_price
]));
fs.writeFileSync(path.join(outDir, 'ports.csv'), 'sector,class,fuel_qty,fuel_price,org_qty,org_price,equ_qty,equ_price\n' + portsRows.join('\n') + '\n');

const planetsRows = planets.map(p => toCSVLine([p.sector, p.planet_name, p.planet_type]));
fs.writeFileSync(path.join(outDir, 'planets.csv'), 'sector,planet_name,planet_type\n' + planetsRows.join('\n') + '\n');

const sql = `BEGIN;

CREATE TABLE sectors (
    id INTEGER PRIMARY KEY,
    name VARCHAR(255)
);

CREATE TABLE warps (
    sector_from INTEGER,
    sector_to INTEGER
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

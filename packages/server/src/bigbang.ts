/**
 * bigbang.ts
 * Reusable universe generation module extracted from scripts/twnr-bigbang.js.
 * Generates sectors, warps, and ports for a twnr universe using deterministic PRNG.
 */

export interface BigBangOptions {
    sectors: number;
    seed?: number;
    portDensity?: number; // 1-100, default 50
    twoWayPct?: number; // 0-100, default 90
}

export interface GeneratedSector {
    id: number;
    name: string;
}

export interface GeneratedWarp {
    from: number;
    to: number;
}

export interface GeneratedPort {
    sector: number;
    class: number;
    fuel_qty: number;
    fuel_price: number;
    org_qty: number;
    org_price: number;
    equ_qty: number;
    equ_price: number;
}

export interface BigBangResult {
    seed: number;
    sectors: GeneratedSector[];
    warps: GeneratedWarp[];
    ports: GeneratedPort[];
}

function mulberry32(a: number): () => number {
    return function () {
        let t = (a += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const portClasses: Record<number, string[]> = {
    1: ['B', 'B', 'S'],
    2: ['B', 'S', 'B'],
    3: ['S', 'B', 'B'],
    4: ['S', 'S', 'B'],
    5: ['B', 'S', 'S'],
    6: ['S', 'B', 'S'],
    7: ['S', 'S', 'S'],
    8: ['B', 'B', 'B'],
};

export function generateUniverse(options: BigBangOptions): BigBangResult {
    const N = options.sectors;
    const portDensity = options.portDensity ?? 50;
    const twoWayPct = options.twoWayPct ?? 90;
    const seed = options.seed ?? Math.floor(Math.random() * 2147483647);

    const rng = mulberry32(seed);

    function randomInt(min: number, max: number): number {
        return Math.floor(rng() * (max - min + 1)) + min;
    }

    // Generate sector names
    const sectorNames = new Array(N + 1).fill('');
    sectorNames[1] = 'Federation Space';
    const stardockId = randomInt(2, N);
    sectorNames[stardockId] = 'Stardock';

    // Generate graph
    const warps = generateGraph(N, twoWayPct, rng);

    // Generate sectors
    const sectors: GeneratedSector[] = [];
    for (let i = 1; i <= N; i++) {
        sectors.push({ id: i, name: sectorNames[i] });
    }

    // Generate ports
    const totalPortsTarget = Math.max(1, Math.round((N * portDensity) / 100));
    const ports: GeneratedPort[] = [];

    function generatePort(sectorId: number, portClass: number): GeneratedPort {
        const pClassStr = portClasses[portClass];
        const generateCommodity = (type: string) => {
            const qty = randomInt(0, 5000);
            const price = type === 'S' ? randomInt(10, 50) : randomInt(51, 100);
            return { qty, price };
        };
        const fuel = generateCommodity(pClassStr[0]);
        const org = generateCommodity(pClassStr[1]);
        const equ = generateCommodity(pClassStr[2]);
        return {
            sector: sectorId,
            class: portClass,
            fuel_qty: fuel.qty,
            fuel_price: fuel.price,
            org_qty: org.qty,
            org_price: org.price,
            equ_qty: equ.qty,
            equ_price: equ.price,
        };
    }

    // Stardock always gets a port (class 8 in generation, will be overridden to 9 later)
    ports.push(generatePort(stardockId, 8));

    let numOtherPorts = totalPortsTarget - 1;
    if (numOtherPorts > N - 2) {
        numOtherPorts = N - 2;
    }

    const availableSectorsForPorts: number[] = [];
    for (let i = 2; i <= N; i++) {
        if (i !== stardockId) {
            availableSectorsForPorts.push(i);
        }
    }
    // Shuffle
    for (let i = availableSectorsForPorts.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [availableSectorsForPorts[i], availableSectorsForPorts[j]] = [
            availableSectorsForPorts[j],
            availableSectorsForPorts[i],
        ];
    }

    let classPool: number[] = [];
    function getNextClass(): number {
        if (classPool.length === 0) {
            classPool = [1, 2, 3, 4, 5, 6, 7, 8];
            for (let i = classPool.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1));
                [classPool[i], classPool[j]] = [classPool[j], classPool[i]];
            }
        }
        return classPool.pop()!;
    }

    for (let i = 0; i < numOtherPorts; i++) {
        const sectorId = availableSectorsForPorts[i];
        const pClass = getNextClass();
        ports.push(generatePort(sectorId, pClass));
    }

    ports.sort((a, b) => a.sector - b.sector);

    return { seed, sectors, warps, ports };
}

function generateGraph(N: number, T: number, rng: () => number): GeneratedWarp[] {
    let bestE_bi = -1,
        bestE_uni = -1,
        minDiff = 100;
    const minW = Math.max(N, 20);
    const maxW = N * 4;

    for (let w = minW; w <= maxW; w++) {
        const targetBi = (w * T) / 100;
        const e_bi = Math.round(targetBi / 2);
        const e_uni = w - 2 * e_bi;

        if (e_bi + e_uni < N) continue;
        if (e_bi < 0 || e_uni < 0) continue;

        const pct = ((2 * e_bi) / w) * 100;
        const diff = Math.abs(pct - T);
        if (diff < minDiff) {
            minDiff = diff;
            bestE_bi = e_bi;
            bestE_uni = e_uni;
        }
    }

    while (true) {
        const outDegree = new Int32Array(N + 1);
        const inDegree = new Int32Array(N + 1);
        const edges = new Set<string>();

        function addEdge(u: number, v: number) {
            edges.add(`${u},${v}`);
            outDegree[u]++;
            inDegree[v]++;
        }
        function canAddPair(u: number, v: number): boolean {
            if (u === v) return false;
            if (edges.has(`${u},${v}`) || edges.has(`${v},${u}`)) return false;
            if (outDegree[u] >= 6 || inDegree[v] >= 6) return false;
            if (outDegree[v] >= 6 || inDegree[u] >= 6) return false;
            return true;
        }
        function canAddSingle(u: number, v: number): boolean {
            if (u === v) return false;
            if (edges.has(`${u},${v}`) || edges.has(`${v},${u}`)) return false;
            if (outDegree[u] >= 6 || inDegree[v] >= 6) return false;
            return true;
        }

        const nodes = Array.from({ length: N }, (_, i) => i + 1);
        for (let i = nodes.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [nodes[i], nodes[j]] = [nodes[j], nodes[i]];
        }

        const K = Math.max(0, N - bestE_uni);
        const cycleEdges: [number, number][] = [];
        for (let i = 0; i < N; i++) {
            cycleEdges.push([nodes[i], nodes[(i + 1) % N]]);
        }

        for (let i = cycleEdges.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [cycleEdges[i], cycleEdges[j]] = [cycleEdges[j], cycleEdges[i]];
        }

        let K_added = 0;
        let single_added = 0;
        for (let i = 0; i < N; i++) {
            const [u, v] = cycleEdges[i];
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
            if (attempts++ > 20000) {
                success = false;
                break;
            }
            const u = Math.floor(rng() * N) + 1;
            const v = Math.floor(rng() * N) + 1;
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
            if (attempts++ > 20000) {
                success = false;
                break;
            }
            const u = Math.floor(rng() * N) + 1;
            const v = Math.floor(rng() * N) + 1;
            if (canAddSingle(u, v)) {
                addEdge(u, v);
                singles_needed--;
                attempts = 0;
            }
        }
        if (!success) continue;

        let valid = true;
        for (let i = 1; i <= N; i++) {
            if (outDegree[i] < 1 || outDegree[i] > 6 || inDegree[i] < 1 || inDegree[i] > 6) {
                valid = false;
                break;
            }
        }
        if (!valid) continue;

        const totalWarps = edges.size;
        let biWarps = 0;
        for (const e of edges) {
            const [u, v] = e.split(',');
            if (edges.has(`${v},${u}`)) biWarps++;
        }
        const actualPct = (biWarps / totalWarps) * 100;
        if (Math.abs(actualPct - T) > 1.0001) {
            continue;
        }

        const result: GeneratedWarp[] = [];
        for (const e of edges) {
            const parts = e.split(',');
            result.push({ from: parseInt(parts[0], 10), to: parseInt(parts[1], 10) });
        }
        result.sort((a, b) => {
            if (a.from !== b.from) return a.from - b.from;
            return a.to - b.to;
        });
        return result;
    }
}

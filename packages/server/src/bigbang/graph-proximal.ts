import type { GeneratedWarp } from './types.js';
import { DEFAULT_TWO_WAY_PCT, DEFAULT_MAX_PATH_LENGTH } from './types.js';
import { HEX_NEIGHBOR_DIRS } from './positions.js';
import type { HexCell } from './positions.js';

/**
 * Build a warp graph on a hex layout:
 *
 *   - Phase A: for every occupied hex cell, connect it to each occupied hex
 *     neighbor. By default the connection is a 2-way pair (warp + reverse
 *     warp); a fraction (1 - twoWayPct/100) becomes one-way only. Both ends
 *     are chosen by RNG; the result is degree = number of occupied neighbors
 *     for cells in dense regions.
 *
 *   - Phase B: keep adding random long-range "wormhole" warps (between
 *     non-adjacent sectors) until BFS eccentricity from a representative
 *     source is ≤ maxPathLength. Capped at a generous edge budget so
 *     pathological graphs still terminate.
 *
 *   - Phase C: ensure the strongly-connected guarantee. After Phase A the
 *     graph is connected within each hex-adjacency component but may have
 *     multiple disjoint components when fillDensity is low. Wormholes also
 *     bridge those components (the BFS check naturally drives this).
 */
export function generateProximalGraph(
    N: number,
    twoWayPercentage: number,
    rng: () => number,
    cells: readonly HexCell[],
    maxPathLength: number = DEFAULT_MAX_PATH_LENGTH,
    forcedHubSectors: readonly number[] = [],
): GeneratedWarp[] {
    if (cells.length !== N) {
        throw new Error(`generateProximalGraph: expected ${N} cells, got ${cells.length}`);
    }
    void forcedHubSectors;
    const twoWayPct = Math.max(0, Math.min(100, twoWayPercentage ?? DEFAULT_TWO_WAY_PCT));
    const diameterCap = Math.max(2, Math.floor(maxPathLength));

    // Index occupied hex cells by axial coordinate so neighbor lookup is O(1).
    const cellKey = (q: number, r: number): string => `${q},${r}`;
    const cellToSector = new Map<string, number>();
    for (let i = 0; i < N; i++) {
        cellToSector.set(cellKey(cells[i].q, cells[i].r), i + 1);
    }

    const edges = new Set<string>();
    const adj: number[][] = Array.from({ length: N + 1 }, () => []);
    function addEdge(u: number, v: number): boolean {
        if (u === v) return false;
        const key = `${u},${v}`;
        if (edges.has(key)) return false;
        edges.add(key);
        adj[u].push(v);
        return true;
    }

    // Phase A: hex-adjacency edges. Visit each unordered pair once (only
    // emit when neighbor's cell index > self in the cells[] order).
    for (let i = 0; i < N; i++) {
        const u = i + 1;
        const cu = cells[i];
        for (const dir of HEX_NEIGHBOR_DIRS) {
            const nv = cellToSector.get(cellKey(cu.q + dir.q, cu.r + dir.r));
            if (nv === undefined) continue;
            if (nv <= u) continue;
            const isTwoWay = rng() * 100 < twoWayPct;
            if (isTwoWay) {
                addEdge(u, nv);
                addEdge(nv, u);
            } else {
                // Coin-flip the direction so one-ways aren't biased to the
                // canonical traversal order.
                if (rng() < 0.5) addEdge(u, nv);
                else addEdge(nv, u);
            }
        }
    }

    // Phase B: wormholes until diameter ≤ cap. We probe diameter by running
    // BFS from a few sources (random + the highest-degree node) and taking
    // the max eccentricity. Cheap, conservative, and converges fast.
    const MAX_WORMHOLES = Math.min(N, Math.ceil(N * 0.2) + 10);
    let placed = 0;
    while (placed < MAX_WORMHOLES) {
        const ecc = estimateDiameter(N, adj, rng);
        if (ecc <= diameterCap) break;
        // Pick two random sectors that aren't already connected (in either
        // direction) and aren't hex-adjacent. The more "across the map"
        // they are, the more eccentricity they cut.
        let u = 0;
        let v = 0;
        for (let attempt = 0; attempt < 50; attempt++) {
            const a = 1 + Math.floor(rng() * N);
            const b = 1 + Math.floor(rng() * N);
            if (a === b) continue;
            if (edges.has(`${a},${b}`) || edges.has(`${b},${a}`)) continue;
            u = a;
            v = b;
            break;
        }
        if (u === 0) break; // gave up — graph is too dense to need wormholes
        addEdge(u, v);
        addEdge(v, u);
        placed++;
    }

    const result: GeneratedWarp[] = [];
    for (const e of edges) {
        const comma = e.indexOf(',');
        result.push({
            from: parseInt(e.substring(0, comma), 10),
            to: parseInt(e.substring(comma + 1), 10),
        });
    }
    result.sort((a, b) => (a.from !== b.from ? a.from - b.from : a.to - b.to));
    return result;
}

/**
 * Quick BFS-from-sampled-sources eccentricity bound. Doesn't compute the
 * exact diameter (that's O(N(N+E)) and expensive) — instead samples a few
 * sources and returns the max eccentricity seen. Tends to *under*-estimate
 * the true diameter on pathological graphs, but for our use case (driving
 * "have we added enough wormholes") it converges fine because each wormhole
 * helps multiple pairs at once.
 */
function estimateDiameter(N: number, adj: number[][], rng: () => number): number {
    if (N <= 1) return 0;
    const SAMPLES = Math.min(8, N);
    const seen = new Set<number>();
    let maxEcc = 0;
    for (let s = 0; s < SAMPLES; s++) {
        let src = 0;
        for (let attempt = 0; attempt < 10; attempt++) {
            src = 1 + Math.floor(rng() * N);
            if (!seen.has(src)) break;
        }
        seen.add(src);
        const ecc = bfsEccentricity(N, adj, src);
        if (ecc > maxEcc) maxEcc = ecc;
    }
    return maxEcc;
}

/** BFS from `src`; returns max distance to any reachable node, or +Infinity if unreachable nodes exist. */
function bfsEccentricity(N: number, adj: number[][], src: number): number {
    const dist = new Int32Array(N + 1).fill(-1);
    dist[src] = 0;
    const queue: number[] = [src];
    let head = 0;
    let maxD = 0;
    let visited = 1;
    while (head < queue.length) {
        const u = queue[head++];
        const d = dist[u];
        for (const v of adj[u]) {
            if (dist[v] !== -1) continue;
            dist[v] = d + 1;
            if (d + 1 > maxD) maxD = d + 1;
            visited++;
            queue.push(v);
        }
    }
    if (visited < N) return Number.POSITIVE_INFINITY;
    return maxD;
}

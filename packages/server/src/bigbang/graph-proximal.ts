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

    // Phase B: wormholes until diameter ≤ cap.
    //
    // Each iteration runs a "double-sweep" diameter probe: BFS from a random
    // source picks the farthest node A; BFS from A picks the farthest node
    // B; dist(A,B) is a tight lower bound on the actual diameter. If we're
    // still over the cap we connect A↔B directly — the most diameter-cutting
    // wormhole possible in that round. If A or B is already at the per-sector
    // out-degree cap, fall back to random pair selection (also cap-aware).
    //
    // Hard out-degree cap: no sector ever gets more than MAX_OUT outbound
    // warps. Phase A respects this by construction (≤6 hex neighbors); Phase
    // B has to enforce it explicitly.
    const MAX_OUT = 6;
    const MAX_WORMHOLES = Math.min(N, Math.ceil(N * 0.2) + 10);
    function canTakeMore(u: number): boolean {
        return adj[u].length < MAX_OUT;
    }
    let placed = 0;
    let stalled = 0;
    while (placed < MAX_WORMHOLES && stalled < 5) {
        const seed = 1 + Math.floor(rng() * N);
        const sweep1 = bfsFarthest(N, adj, seed);
        const sweep2 = bfsFarthest(N, adj, sweep1.node);
        if (sweep2.dist <= diameterCap) break;

        let u = sweep2.node;
        let v = sweep1.node;
        const peripheralOk =
            u !== v &&
            canTakeMore(u) &&
            canTakeMore(v) &&
            !edges.has(`${u},${v}`) &&
            !edges.has(`${v},${u}`);
        if (!peripheralOk) {
            // Peripheral pair is full or already connected — fall back to a
            // random capacity-aware pair. Diameter still drops, just less
            // aggressively per iteration.
            u = 0;
            v = 0;
            for (let attempt = 0; attempt < 50; attempt++) {
                const a = 1 + Math.floor(rng() * N);
                const b = 1 + Math.floor(rng() * N);
                if (a === b) continue;
                if (!canTakeMore(a) || !canTakeMore(b)) continue;
                if (edges.has(`${a},${b}`) || edges.has(`${b},${a}`)) continue;
                u = a;
                v = b;
                break;
            }
            if (u === 0) {
                stalled++;
                continue;
            }
        }
        addEdge(u, v);
        addEdge(v, u);
        placed++;
        stalled = 0;
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
 * BFS from `src`; returns the farthest reachable node and its distance.
 * Used by the Phase B double-sweep to find peripheral nodes — running this
 * twice (once from a random source, then again from the resulting node)
 * yields a tight lower bound on graph diameter and identifies the actual
 * pair to bridge with a wormhole.
 *
 * If parts of the graph are unreachable from `src`, the second sweep will
 * still target the farthest reachable node — which means a disconnected
 * component is treated as having an "infinite" diameter and naturally gets
 * a wormhole connecting it to the main component.
 */
function bfsFarthest(N: number, adj: number[][], src: number): { node: number; dist: number } {
    const dist = new Int32Array(N + 1).fill(-1);
    dist[src] = 0;
    const queue: number[] = [src];
    let head = 0;
    let farthestNode = src;
    let farthestDist = 0;
    while (head < queue.length) {
        const u = queue[head++];
        const d = dist[u];
        for (const v of adj[u]) {
            if (dist[v] !== -1) continue;
            dist[v] = d + 1;
            if (d + 1 > farthestDist) {
                farthestDist = d + 1;
                farthestNode = v;
            }
            queue.push(v);
        }
    }
    // Treat unreachable nodes as infinitely far so the wormhole-add loop
    // bridges disconnected components even before diameter falls under cap.
    let visited = 0;
    for (let i = 1; i <= N; i++) if (dist[i] !== -1) visited++;
    if (visited < N) {
        for (let i = 1; i <= N; i++) {
            if (dist[i] === -1) return { node: i, dist: Number.POSITIVE_INFINITY };
        }
    }
    return { node: farthestNode, dist: farthestDist };
}

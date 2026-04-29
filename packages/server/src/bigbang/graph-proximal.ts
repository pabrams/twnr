import type { GeneratedWarp } from './types.js';
import { DEFAULT_TWO_WAY_PCT, DEFAULT_MAX_PATH_LENGTH, DEFAULT_WARP_DIST } from './types.js';
import { HEX_NEIGHBOR_DIRS, hexToCartesian } from './positions.js';
import type { HexCell } from './positions.js';

const MAX_OUT = 6;

/**
 * Sample a per-sector target out-degree from a 1-indexed cumulative
 * distribution `warpDist[1..6]`. Forced-hub sectors get MAX_OUT regardless.
 */
function assignTargetOutDegrees(
    N: number,
    rng: () => number,
    warpDist: number[],
    forcedMaxOutSectors: readonly number[],
): Int32Array {
    const targetOut = new Int32Array(N + 1);
    const cumDist = new Float64Array(MAX_OUT + 1);
    let pctSum = 0;
    for (let d = 1; d <= MAX_OUT; d++) {
        pctSum += warpDist[d] ?? 0;
        cumDist[d] = pctSum;
    }
    if (pctSum <= 0) {
        // Degenerate input — fall back to MAX_OUT for every sector.
        for (let i = 1; i <= N; i++) targetOut[i] = MAX_OUT;
    } else {
        for (let i = 1; i <= N; i++) {
            const r = rng() * pctSum;
            for (let d = 1; d <= MAX_OUT; d++) {
                if (r < cumDist[d]) {
                    targetOut[i] = d;
                    break;
                }
            }
            if (targetOut[i] === 0) targetOut[i] = MAX_OUT;
        }
    }
    for (const sid of forcedMaxOutSectors) {
        if (sid >= 1 && sid <= N) targetOut[sid] = MAX_OUT;
    }
    return targetOut;
}

/**
 * Build a warp graph on a hex layout:
 *
 *   - Phase A: each sector gets a target out-degree sampled from `warpDist`
 *     (1..6). We walk adjacent occupied-cell pairs in random order and emit
 *     edges only while neither endpoint is over its target. `twoWayPct`
 *     decides whether a pair becomes bidirectional or one-way; pairs that
 *     wanted bidirectional but found one endpoint full are skipped (rather
 *     than degraded to one-way) so the user's twoWayPct is preserved.
 *
 *   - Phase B: bridge weakly-connected components. Phase A's skip-on-full
 *     rule can leave isolated mini-components, so we explicitly walk the
 *     component graph and emit a two-way wormhole from each non-main
 *     island to the main component until the graph is connected.
 *
 *   - Phase C: long-range "wormhole" pairs are added until BFS eccentricity
 *     from sampled sources falls under `maxPathLength`. Wormholes respect
 *     the hard MAX_OUT cap of 6 outbound warps per sector.
 */
export function generateProximalGraph(
    N: number,
    twoWayPercentage: number,
    rng: () => number,
    cells: readonly HexCell[],
    maxPathLength: number = DEFAULT_MAX_PATH_LENGTH,
    forcedHubSectors: readonly number[] = [],
    warpDist: number[] = DEFAULT_WARP_DIST,
): GeneratedWarp[] {
    if (cells.length !== N) {
        throw new Error(`generateProximalGraph: expected ${N} cells, got ${cells.length}`);
    }
    const twoWayPct = Math.max(0, Math.min(100, twoWayPercentage ?? DEFAULT_TWO_WAY_PCT));
    const diameterCap = Math.max(2, Math.floor(maxPathLength));
    const targetOut = assignTargetOutDegrees(N, rng, warpDist, forcedHubSectors);

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
    function hasRoom(u: number): boolean {
        return adj[u].length < targetOut[u];
    }

    // Phase A: collect every unordered adjacent occupied-pair, shuffle, then
    // emit edges respecting per-sector target out-degree. Skipping pairs
    // when both endpoints are already at target is what gives the user
    // back the configured warpDist shape — a sector with target degree 2
    // doesn't get all 6 of its hex neighbors connected.
    const pairs: { u: number; v: number }[] = [];
    for (let i = 0; i < N; i++) {
        const u = i + 1;
        const cu = cells[i];
        for (const dir of HEX_NEIGHBOR_DIRS) {
            const nv = cellToSector.get(cellKey(cu.q + dir.q, cu.r + dir.r));
            if (nv === undefined || nv <= u) continue;
            pairs.push({ u, v: nv });
        }
    }
    for (let i = pairs.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
    }
    for (const { u, v } of pairs) {
        const uRoom = hasRoom(u);
        const vRoom = hasRoom(v);
        if (!uRoom && !vRoom) continue;
        const wantTwoWay = rng() * 100 < twoWayPct;
        if (wantTwoWay) {
            // Only honour two-ways when both endpoints have room. Falling
            // back to a one-way when one side is full would silently inflate
            // the one-way count — once a sector hits its target every
            // remaining pair touching it would degrade. Skip instead so the
            // emitted twoWayPct ratio stays close to what the user asked
            // for. Trade-off: some hex-adjacent pairs end up unconnected.
            if (uRoom && vRoom) {
                addEdge(u, v);
                addEdge(v, u);
            }
        } else if (uRoom && vRoom) {
            // Want one-way and both have room — pick a direction.
            if (rng() < 0.5) addEdge(u, v);
            else addEdge(v, u);
        } else if (uRoom) {
            addEdge(u, v);
        } else {
            addEdge(v, u);
        }
    }

    function canTakeMore(u: number): boolean {
        return adj[u].length < MAX_OUT;
    }

    // Phase B: bridge weakly-connected components. Phase A's "skip rather
    // than degrade two-way to one-way" rule can leave sectors with too few
    // (or zero) local edges, producing isolated mini-components — and the
    // diameter-shrinking loop below doesn't reliably merge tiny islands
    // (its random seed rarely lands inside them). So we explicitly walk
    // components and emit a two-way wormhole from each non-main component
    // into the main one until the graph is weakly connected.
    {
        // Precompute cartesian positions once so the closest-pair search
        // doesn't redo hex→xy conversions per iteration.
        const positions = cells.map((c) => hexToCartesian(c.q, c.r));
        let safety = N + 10;
        while (safety-- > 0) {
            const comp = findWeakComponents(N, adj);
            const sizes = new Map<number, number>();
            for (let i = 1; i <= N; i++) {
                sizes.set(comp[i], (sizes.get(comp[i]) ?? 0) + 1);
            }
            if (sizes.size <= 1) break;
            // Pick the largest component as the merge target.
            let mainId = -1;
            let mainSize = -1;
            for (const [id, sz] of sizes) {
                if (sz > mainSize) {
                    mainSize = sz;
                    mainId = id;
                }
            }
            // Pick any non-main component to merge.
            let chosenIslandId = -1;
            for (const id of sizes.keys()) {
                if (id !== mainId) {
                    chosenIslandId = id;
                    break;
                }
            }
            if (chosenIslandId === -1) break;

            // Find the *closest* island↔main pair (Euclidean) — singletons
            // adjacent to the main component bridge with a 1-cell-wide
            // edge (well under the wormhole-distance threshold), so they
            // don't show up as long-jump wormholes on the map. Only
            // genuinely far-apart pockets produce true wormholes here.
            let bestDist = Infinity;
            let bestI = -1;
            let bestJ = -1;
            for (let i = 1; i <= N; i++) {
                if (comp[i] !== chosenIslandId) continue;
                if (!canTakeMore(i)) continue;
                const pi = positions[i - 1];
                for (let j = 1; j <= N; j++) {
                    if (comp[j] !== mainId) continue;
                    if (!canTakeMore(j)) continue;
                    const pj = positions[j - 1];
                    const dx = pi.x - pj.x;
                    const dy = pi.y - pj.y;
                    const d2 = dx * dx + dy * dy;
                    if (d2 < bestDist) {
                        bestDist = d2;
                        bestI = i;
                        bestJ = j;
                    }
                }
            }
            // Fallback: if every endpoint is at MAX_OUT, force-bridge any
            // pair so we don't leave the graph disconnected.
            if (bestI === -1 || bestJ === -1) {
                for (let i = 1; i <= N; i++) {
                    if (bestI === -1 && comp[i] === chosenIslandId) bestI = i;
                    if (bestJ === -1 && comp[i] === mainId) bestJ = i;
                    if (bestI !== -1 && bestJ !== -1) break;
                }
            }
            if (bestI === -1 || bestJ === -1) break;
            addEdge(bestI, bestJ);
            addEdge(bestJ, bestI);
        }
    }

    // Phase C: wormholes until diameter ≤ cap.
    //
    // Each iteration runs a "double-sweep" diameter probe: BFS from a random
    // source picks the farthest node A; BFS from A picks the farthest node
    // B; dist(A,B) is a tight lower bound on the actual diameter. If we're
    // still over the cap we connect A↔B directly — the most diameter-cutting
    // wormhole possible in that round. If A or B is already at the per-sector
    // out-degree cap, fall back to random pair selection (also cap-aware).
    //
    // No hard budget cap on wormhole count: the user's `maxPathLength` is the
    // real constraint, and aggressive targets (e.g. diameter 5 on a large
    // universe) require many wormholes by small-world math. The `stalled`
    // counter is the natural safety exit — once every sector hits MAX_OUT
    // and random pair selection can't find any addable pair for several
    // rounds, we stop. ITER_BOUND is a paranoid backstop only.
    const ITER_BOUND = Math.max(1000, N * 10);
    let placed = 0;
    let stalled = 0;
    let iter = 0;
    while (stalled < 5 && iter++ < ITER_BOUND) {
        // Multi-sample double-sweep: a single random source can land in a
        // central region and underestimate the actual diameter, causing
        // premature exit when the cap is tight. Take the best (longest)
        // peripheral pair across SAMPLES sources before deciding.
        const SAMPLES = 4;
        let bestU = -1;
        let bestV = -1;
        let bestDist = -1;
        for (let s = 0; s < SAMPLES; s++) {
            const seed = 1 + Math.floor(rng() * N);
            const sweep1 = bfsFarthest(N, adj, seed);
            const sweep2 = bfsFarthest(N, adj, sweep1.node);
            if (sweep2.dist > bestDist) {
                bestDist = sweep2.dist;
                bestU = sweep2.node;
                bestV = sweep1.node;
            }
        }
        if (bestDist <= diameterCap) break;

        let u = bestU;
        let v = bestV;
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
 * Compute weakly-connected component ids for every node. "Weak" means edges
 * are treated as undirected — if `u→v` exists, both belong to the same
 * component regardless of whether `v→u` does. Returns a 1-indexed array
 * `comp` where `comp[i]` is the component id of sector `i`. Component ids
 * are arbitrary integers, only meaningful for equality comparisons.
 */
function findWeakComponents(N: number, adj: number[][]): Int32Array {
    const undirected: Set<number>[] = Array.from({ length: N + 1 }, () => new Set<number>());
    for (let u = 1; u <= N; u++) {
        for (const v of adj[u]) {
            undirected[u].add(v);
            undirected[v].add(u);
        }
    }
    const comp = new Int32Array(N + 1).fill(-1);
    let nextId = 0;
    for (let start = 1; start <= N; start++) {
        if (comp[start] !== -1) continue;
        const id = nextId++;
        const stack = [start];
        while (stack.length) {
            const u = stack.pop()!;
            if (comp[u] !== -1) continue;
            comp[u] = id;
            for (const v of undirected[u]) {
                if (comp[v] === -1) stack.push(v);
            }
        }
    }
    return comp;
}

/**
 * BFS from `src`; returns the farthest reachable node and its distance.
 * Used by the Phase C double-sweep to find peripheral nodes — running this
 * twice (once from a random source, then again from the resulting node)
 * yields a tight lower bound on graph diameter and identifies the actual
 * pair to bridge with a wormhole. After the connectivity pass (Phase B)
 * the graph is guaranteed weakly connected, so unreachable-node fallbacks
 * here only matter for directed reachability.
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

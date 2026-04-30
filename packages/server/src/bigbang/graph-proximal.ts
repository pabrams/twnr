import type { GeneratedWarp } from './types.js';
import { DEFAULT_TWO_WAY_PCT, DEFAULT_MAX_PATH_LENGTH, DEFAULT_WARP_DIST } from './types.js';
import { HEX_NEIGHBOR_DIRS } from './positions.js';
import type { HexCell } from './positions.js';

const MAX_OUT = 6;
const MAX_IN = 6;

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
 *     edges only while neither endpoint is over its target *and* neither
 *     receiver is at MAX_IN. `twoWayPct` decides whether a pair becomes
 *     bidirectional or one-way; pairs that wanted bidirectional but found
 *     one endpoint full are skipped (rather than degraded to one-way) so
 *     the user's twoWayPct is preserved.
 *
 *   - Phase B: enforce strong connectivity. Phase A leaves the directed
 *     graph in possibly many strongly connected components; we find the
 *     SCCs and stitch them into a single SCC by adding one-way edges in
 *     a ring through their representatives. One-way (not two-way) so the
 *     bridge edges don't inflate the user's bidirectional ratio. The ring
 *     never adds more than 2 edges per SCC and respects MAX_OUT / MAX_IN.
 *
 *   - Phase C: long-range "wormhole" pairs are added until directed-BFS
 *     eccentricity from sampled sources falls under `maxPathLength`.
 *     Wormholes respect both MAX_OUT/MAX_IN caps and the user's
 *     `twoWayPct` (each wormhole flips a coin for direction style).
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
    // `twoWayPct` is interpreted as the desired bidirectional ratio on the
    // *final directed-edge* graph (matching what the test measures: count
    // of edges whose reverse also exists, divided by total edges). The
    // per-pair coin we flip is a different quantity though: a 2-way
    // attempt emits 2 directed edges, a 1-way attempt emits 1. Solving
    // 2p / (p+1) = twp/100 for p gives the per-pair probability that
    // produces the requested directed-edge ratio. Examples: twp=50 →
    // p=33.3%, twp=98 → p=96.08%. Endpoints (0, 100) map to themselves.
    const pairBidiProb = twoWayPct / Math.max(1, 200 - twoWayPct);
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
    const inDeg = new Int32Array(N + 1);
    function addEdge(u: number, v: number): boolean {
        if (u === v) return false;
        const key = `${u},${v}`;
        if (edges.has(key)) return false;
        if (adj[u].length >= MAX_OUT) return false;
        if (inDeg[v] >= MAX_IN) return false;
        edges.add(key);
        adj[u].push(v);
        inDeg[v]++;
        return true;
    }
    function hasOutRoom(u: number): boolean {
        return adj[u].length < targetOut[u];
    }
    function hasInRoom(v: number): boolean {
        return inDeg[v] < MAX_IN;
    }

    // Phase A: collect every unordered adjacent occupied-pair, shuffle, then
    // emit edges respecting per-sector target out-degree AND the hard MAX_IN
    // cap. Skipping pairs when both endpoints are already at target is what
    // gives the user back the configured warpDist shape — a sector with
    // target degree 2 doesn't get all 6 of its hex neighbors connected.
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
        const uOut = hasOutRoom(u);
        const vOut = hasOutRoom(v);
        if (!uOut && !vOut) continue;
        const wantTwoWay = rng() < pairBidiProb;
        if (wantTwoWay) {
            // Two-way only when both directions have full capacity. Skip
            // (don't degrade to 1-way) so the bidi/one-way mix stays
            // proportional — degrading a missed 2-way to a 1-way would
            // bias the final ratio toward 1-ways. Trade-off: some
            // hex-adjacent pairs end up unconnected.
            if (uOut && vOut && hasInRoom(u) && hasInRoom(v)) {
                addEdge(u, v);
                addEdge(v, u);
            }
        } else if (uOut && vOut) {
            // Want 1-way and both endpoints have out-room. Pick a
            // direction that respects the receiver's in-cap.
            const goUtoV = rng() < 0.5;
            if (goUtoV && hasInRoom(v)) addEdge(u, v);
            else if (!goUtoV && hasInRoom(u)) addEdge(v, u);
            else if (hasInRoom(v)) addEdge(u, v);
            else if (hasInRoom(u)) addEdge(v, u);
        } else if (uOut && hasInRoom(v)) {
            addEdge(u, v);
        } else if (vOut && hasInRoom(u)) {
            addEdge(v, u);
        }
    }

    // Phase B: enforce strong connectivity by closing the SCC condensation
    // into a single ring. Each ring edge flips a coin against `twoWayPct`
    // for two-way vs one-way, the same as Phase A — that way bridge edges
    // stay statistically aligned with the user's bidirectional ratio
    // instead of biasing it. Strong connectivity holds either way: even
    // when every ring edge is one-way (twp=0), the directed cycle through
    // the SCC representatives gives mutual reachability.
    {
        const { compId, numComps } = findStronglyConnectedComponents(N, adj);
        if (numComps > 1) {
            const byComp: number[][] = Array.from({ length: numComps }, () => []);
            for (let u = 1; u <= N; u++) byComp[compId[u]].push(u);

            // Pick a sender (out-room first, then any) and a receiver (in-room
            // first, then any) for each SCC. The ring goes 0 → 1 → … → k-1 → 0
            // through these representatives. Kosaraju emits SCCs in topological
            // order of the condensation (sources first, sinks last); closing a
            // ring through that ordering tends to add the minimum number of
            // back-edges given the DAG shape.
            function pickSender(c: number): number {
                for (const u of byComp[c]) if (adj[u].length < MAX_OUT) return u;
                return byComp[c][0]!;
            }
            function pickReceiver(c: number): number {
                for (const u of byComp[c]) if (inDeg[u] < MAX_IN) return u;
                return byComp[c][0]!;
            }
            for (let i = 0; i < numComps; i++) {
                const from = pickSender(i);
                const to = pickReceiver((i + 1) % numComps);
                addEdge(from, to);
                // Also add the reverse direction with probability `twoWayPct`
                // so bridge edges don't drag the bidi ratio away from target.
                if (rng() < pairBidiProb) {
                    addEdge(to, from);
                }
            }
        }
    }

    // Phase C: wormholes until directed BFS eccentricity ≤ cap.
    //
    // Each iteration runs a "double-sweep" diameter probe: BFS from a random
    // source picks the farthest node A; BFS from A picks the farthest node
    // B; dist(A,B) is a tight lower bound on the actual diameter. If we're
    // still over the cap we connect A↔B directly — the most diameter-cutting
    // wormhole possible in that round. If A or B is already at the per-sector
    // out-degree cap, fall back to random pair selection (also cap-aware).
    //
    // Each wormhole respects `twoWayPct`: bidi vs one-way is chosen the same
    // way Phase A chooses, so wormhole-bridging doesn't pull the final bidi
    // ratio away from the user's target.
    //
    // No hard budget cap on wormhole count: the user's `maxPathLength` is the
    // real constraint, and aggressive targets (e.g. diameter 5 on a large
    // universe) require many wormholes by small-world math. The `stalled`
    // counter is the natural safety exit — once every sector hits MAX_OUT
    // and random pair selection can't find any addable pair for several
    // rounds, we stop. ITER_BOUND is a paranoid backstop only.
    const ITER_BOUND = Math.max(1000, N * 10);
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
            u !== v && adj[u].length < MAX_OUT && inDeg[v] < MAX_IN && !edges.has(`${u},${v}`);
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
                if (adj[a].length >= MAX_OUT || inDeg[b] >= MAX_IN) continue;
                if (edges.has(`${a},${b}`)) continue;
                u = a;
                v = b;
                break;
            }
            if (u === 0) {
                stalled++;
                continue;
            }
        }
        // Honour twoWayPct: wormholes respect the user's bidi target.
        const wantTwoWay = rng() < pairBidiProb;
        let added = false;
        if (wantTwoWay && adj[v].length < MAX_OUT && inDeg[u] < MAX_IN && !edges.has(`${v},${u}`)) {
            const a = addEdge(u, v);
            const b = addEdge(v, u);
            added = a || b;
        } else {
            added = addEdge(u, v);
        }
        if (added) stalled = 0;
        else stalled++;
    }

    // Phase D: rebalance the bidi ratio to land within ±2% of `twoWayPct`.
    // Phase A's "skip 2-way on no-room" creates an asymmetric skip rate
    // between 2-way and 1-way attempts that's hard to predict — at low/mid
    // twp values the surviving graph leans more 1-way than the math
    // predicts. This pass counts the actual mix and either promotes random
    // 1-ways (adds reverse direction) or demotes random bidi pairs
    // (removes one direction) until the ratio matches the target. Demotion
    // skips edges whose removal would leave the recipient with in-degree
    // 0; promotion is always safe (only adds edges, can't break SCC).
    {
        const X = twoWayPct / 100;
        // Count current bidi pairs and one-way edges.
        let bidiPairCount = 0;
        const oneWayList: [number, number][] = [];
        for (const e of edges) {
            const comma = e.indexOf(',');
            const a = parseInt(e.substring(0, comma), 10);
            const b = parseInt(e.substring(comma + 1), 10);
            if (edges.has(`${b},${a}`)) {
                if (a < b) bidiPairCount++;
            } else {
                oneWayList.push([a, b]);
            }
        }
        // Target K such that final bidi% equals X exactly:
        //   2(B+K) / (2(B+K) + (U - K)) = X
        // Solving: K = (X*U - 2B*(1-X)) / (2-X)
        // Positive K → promote K one-ways to bidi.
        // Negative K → demote |K| bidi pairs to one-way.
        const B = bidiPairCount;
        const U = oneWayList.length;
        const K = Math.round((X * U - 2 * B * (1 - X)) / (2 - X));

        if (K > 0) {
            // Promote: shuffle one-ways, try adding reverse.
            for (let i = oneWayList.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1));
                [oneWayList[i], oneWayList[j]] = [oneWayList[j], oneWayList[i]];
            }
            let promoted = 0;
            for (const [a, b] of oneWayList) {
                if (promoted >= K) break;
                if (addEdge(b, a)) promoted++;
            }
        } else if (K < 0) {
            // Demote: pick bidi pairs in random order, remove one direction.
            // Skip if removing would zero-out the recipient's in-degree
            // (would break strong connectivity).
            const target = -K;
            const bidiPairs: [number, number][] = [];
            for (const e of edges) {
                const comma = e.indexOf(',');
                const a = parseInt(e.substring(0, comma), 10);
                const b = parseInt(e.substring(comma + 1), 10);
                if (a < b && edges.has(`${b},${a}`)) bidiPairs.push([a, b]);
            }
            for (let i = bidiPairs.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1));
                [bidiPairs[i], bidiPairs[j]] = [bidiPairs[j], bidiPairs[i]];
            }
            let demoted = 0;
            for (const [a, b] of bidiPairs) {
                if (demoted >= target) break;
                // Try removing a→b first (prefer keeping b→a so b stays
                // reachable from a-side). Only remove if the recipient
                // (b for a→b, a for b→a) has other inbound edges.
                const removeAtoB = inDeg[b] > 1 && (rng() < 0.5 || inDeg[a] <= 1);
                if (removeAtoB) {
                    edges.delete(`${a},${b}`);
                    adj[a] = adj[a].filter((x) => x !== b);
                    inDeg[b]--;
                    demoted++;
                } else if (inDeg[a] > 1) {
                    edges.delete(`${b},${a}`);
                    adj[b] = adj[b].filter((x) => x !== a);
                    inDeg[a]--;
                    demoted++;
                }
            }
        }
    }

    // Phase E: re-verify strong connectivity after the rebalance pass.
    // Demotion in Phase D can — rarely — break SCC. Run the same SCC
    // bridging logic as Phase B once more to catch any regression.
    {
        const { compId, numComps } = findStronglyConnectedComponents(N, adj);
        if (numComps > 1) {
            const byComp: number[][] = Array.from({ length: numComps }, () => []);
            for (let u = 1; u <= N; u++) byComp[compId[u]].push(u);
            for (let i = 0; i < numComps; i++) {
                let from = byComp[i][0]!;
                for (const u of byComp[i])
                    if (adj[u].length < MAX_OUT) {
                        from = u;
                        break;
                    }
                let to = byComp[(i + 1) % numComps][0]!;
                for (const u of byComp[(i + 1) % numComps])
                    if (inDeg[u] < MAX_IN) {
                        to = u;
                        break;
                    }
                addEdge(from, to);
            }
        }
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
 * Kosaraju's strongly-connected-components algorithm. Returns 1-indexed
 * `compId[i]` giving the SCC id of sector `i`. SCCs are numbered in
 * topological order of the condensation DAG: SCC 0 is a source (no
 * incoming cross-SCC edges), SCC numComps-1 is a sink (no outgoing).
 *
 * Iterative (no recursion) so it handles N=1000+ without stack overflows.
 */
function findStronglyConnectedComponents(
    N: number,
    adj: number[][],
): { compId: Int32Array; numComps: number } {
    const visited = new Uint8Array(N + 1);
    const finishOrder: number[] = [];

    // First pass: DFS on G, record nodes in finish order.
    for (let start = 1; start <= N; start++) {
        if (visited[start]) continue;
        const stack: { u: number; iter: number }[] = [{ u: start, iter: 0 }];
        visited[start] = 1;
        while (stack.length > 0) {
            const top = stack[stack.length - 1];
            const neighbors = adj[top.u];
            if (top.iter < neighbors.length) {
                const w = neighbors[top.iter++];
                if (!visited[w]) {
                    visited[w] = 1;
                    stack.push({ u: w, iter: 0 });
                }
            } else {
                finishOrder.push(top.u);
                stack.pop();
            }
        }
    }

    // Build reversed adjacency list for the second pass.
    const radj: number[][] = Array.from({ length: N + 1 }, () => []);
    for (let u = 1; u <= N; u++) {
        for (const v of adj[u]) radj[v].push(u);
    }

    // Second pass: DFS on G^T in reverse finish order. Each tree = one SCC.
    const compId = new Int32Array(N + 1).fill(-1);
    let nextComp = 0;
    for (let i = finishOrder.length - 1; i >= 0; i--) {
        const start = finishOrder[i];
        if (compId[start] !== -1) continue;
        compId[start] = nextComp;
        const stack = [start];
        while (stack.length > 0) {
            const u = stack.pop()!;
            for (const w of radj[u]) {
                if (compId[w] === -1) {
                    compId[w] = nextComp;
                    stack.push(w);
                }
            }
        }
        nextComp++;
    }

    return { compId, numComps: nextComp };
}

/**
 * BFS from `src`; returns the farthest reachable node and its distance.
 * Used by the Phase C double-sweep to find peripheral nodes — running this
 * twice (once from a random source, then again from the resulting node)
 * yields a tight lower bound on graph diameter and identifies the actual
 * pair to bridge with a wormhole. After Phase B's SCC bridging the graph
 * is guaranteed strongly connected, so the unreachable-node fallback only
 * matters for defensive correctness if a future phase weakens that.
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

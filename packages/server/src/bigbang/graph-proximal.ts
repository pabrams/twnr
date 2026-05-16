import type { GeneratedWarp, MaxShortestPath } from './types.js';
import { maxShortestPathFor } from './types.js';
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
    forcedHubSectors: readonly number[],
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
    for (const sid of forcedHubSectors) {
        if (sid >= 1 && sid <= N) targetOut[sid] = MAX_OUT;
    }
    return targetOut;
}

/**
 * Subtractive warp generator on a hex layout:
 *
 *   - Phase 0: every hex-adjacent occupied pair starts as a bidi warp.
 *     Each sector's initial out-degree equals the number of its occupied
 *     hex neighbors (3 on a corner, 4 on an edge, 6 in the interior).
 *
 *   - Phase 1: each sector samples a target out-degree from `warpDist`
 *     (`forcedHubSectors` get MAX_OUT).
 *
 *   - Phase 2: walk overfull sectors and prune their out-edges down to
 *     target. Per removal: if the neighbor on the other end is also
 *     overfull we DELETE the bidi pair (drops both endpoints by 1); if
 *     the neighbor is at or below its target we DEGRADE to 1-way
 *     (removes only the overfull side's direction). This naturally
 *     biases the area around low-target sectors toward bidi and the
 *     area around hubs toward 1-way fanout.
 *
 *   - Phase 3: a final pass nudges the bidi/one-way ratio toward
 *     `twoWayPct` by demoting random bidi pairs to 1-way (or promoting
 *     1-ways to bidi). Demotion is in-degree-safe; promotion respects
 *     each endpoint's targetOut so the warpDist achievement stays put.
 *
 *   - Phase 4: re-verify strong connectivity. Pruning can disconnect
 *     the graph; we stitch SCCs into a single ring exactly like the
 *     previous version did.
 *
 * Wormholes and the diameter cap are intentionally gone — the universe
 * diameter is now whatever the local-only structure produces.
 */
export function generateProximalGraph(
    N: number,
    twoWayPercentage: number,
    rng: () => number,
    cells: readonly HexCell[],
    forcedHubSectors: readonly number[],
    warpDist: number[],
    maxShortestPath: MaxShortestPath = 'medium',
): GeneratedWarp[] {
    if (cells.length !== N) {
        throw new Error(`generateProximalGraph: expected ${N} cells, got ${cells.length}`);
    }
    const twoWayPct = Math.max(0, Math.min(100, twoWayPercentage));
    const targetOut = assignTargetOutDegrees(N, rng, warpDist, forcedHubSectors);

    // Index occupied hex cells by axial coordinate for O(1) neighbor lookup.
    const cellKey = (q: number, r: number): string => `${q},${r}`;
    const cellToSector = new Map<string, number>();
    for (let i = 0; i < N; i++) {
        cellToSector.set(cellKey(cells[i].q, cells[i].r), i + 1);
    }

    const edges = new Set<string>();
    const adj: Set<number>[] = Array.from({ length: N + 1 }, () => new Set<number>());
    const inDeg = new Int32Array(N + 1);
    function addEdge(u: number, v: number): boolean {
        if (u === v) return false;
        const key = `${u},${v}`;
        if (edges.has(key)) return false;
        if (adj[u].size >= MAX_OUT) return false;
        if (inDeg[v] >= MAX_IN) return false;
        edges.add(key);
        adj[u].add(v);
        inDeg[v]++;
        return true;
    }
    function removeEdge(u: number, v: number): boolean {
        const key = `${u},${v}`;
        if (!edges.has(key)) return false;
        edges.delete(key);
        adj[u].delete(v);
        inDeg[v]--;
        return true;
    }

    // Phase 0: every hex-adjacent occupied pair → bidi warp.
    for (let i = 0; i < N; i++) {
        const u = i + 1;
        const cu = cells[i];
        for (const dir of HEX_NEIGHBOR_DIRS) {
            const v = cellToSector.get(cellKey(cu.q + dir.q, cu.r + dir.r));
            if (v === undefined || v <= u) continue;
            addEdge(u, v);
            addEdge(v, u);
        }
    }

    // Phase 2: prune overfull sectors. Process by descending surplus so the
    // most-overfull sectors find the most overfull neighbors (both want to
    // lose) and we get clean bidi-pair deletes early. Re-sort as we go since
    // each removal updates the surplus of both endpoints.
    function surplus(s: number): number {
        return adj[s].size - targetOut[s];
    }
    const overfullQueue: number[] = [];
    for (let s = 1; s <= N; s++) if (surplus(s) > 0) overfullQueue.push(s);
    while (overfullQueue.length > 0) {
        // Pick the current most-overfull sector.
        let bestIdx = 0;
        let bestSurplus = surplus(overfullQueue[0]);
        for (let i = 1; i < overfullQueue.length; i++) {
            const s = overfullQueue[i];
            const sur = surplus(s);
            if (sur > bestSurplus) {
                bestSurplus = sur;
                bestIdx = i;
            }
        }
        const u = overfullQueue[bestIdx];
        if (bestSurplus <= 0) {
            overfullQueue.splice(bestIdx, 1);
            continue;
        }
        // Pick a removal target. Prefer neighbors that are themselves
        // overfull (DELETE the bidi pair — drops both); otherwise DEGRADE.
        // Within each tier, shuffle for spatial uniformity.
        const candidates = [...adj[u]];
        // Fisher–Yates
        for (let i = candidates.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
        }
        let removed = false;
        // First pass: find a neighbor that's also overfull (mutual DELETE).
        for (const v of candidates) {
            if (surplus(v) <= 0) continue;
            // DELETE the bidi pair.
            removeEdge(u, v);
            if (edges.has(`${v},${u}`)) removeEdge(v, u);
            removed = true;
            break;
        }
        if (!removed) {
            // Second pass: any neighbor. DEGRADE — drop u→v only (or both
            // if no reverse exists). Try to preserve reverse so v's
            // out-degree stays put.
            for (const v of candidates) {
                removeEdge(u, v);
                // Don't touch v→u; this leaves a 1-way v→u edge if it
                // existed, which is exactly the degrade behavior.
                removed = true;
                break;
            }
        }
        if (!removed) {
            // Pathological — sector has surplus but no out-edges (can't
            // happen given the surplus check, but defensive).
            overfullQueue.splice(bestIdx, 1);
        }
    }

    // Phase 3: rebalance bidi ratio toward twoWayPct. Same math as the old
    // Phase D, but promotions are capped at the recipient's targetOut so we
    // don't undo Phase 2's distribution work. Demotion uses the existing
    // safety: skip if removal would leave the recipient at in-degree 0.
    {
        const X = twoWayPct / 100;
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
        const B = bidiPairCount;
        const U = oneWayList.length;
        const K = Math.round((X * U - 2 * B * (1 - X)) / (2 - X));

        if (K > 0) {
            for (let i = oneWayList.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1));
                [oneWayList[i], oneWayList[j]] = [oneWayList[j], oneWayList[i]];
            }
            // Promotion lets sectors exceed their warpDist target up to
            // MAX_OUT — the hard cap. With the subtractive Phase 2 the
            // total 1-way pool is small (only DEGRADEs around hubs), so
            // this can't runaway the way it did in the old additive code.
            let promoted = 0;
            for (const [a, b] of oneWayList) {
                if (promoted >= K) break;
                if (addEdge(b, a)) promoted++;
            }
        } else if (K < 0) {
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
                const removeAtoB = inDeg[b] > 1 && (rng() < 0.5 || inDeg[a] <= 1);
                if (removeAtoB) {
                    removeEdge(a, b);
                    demoted++;
                } else if (inDeg[a] > 1) {
                    removeEdge(b, a);
                    demoted++;
                }
            }
        }
    }

    // Phase 4: enforce strong connectivity by closing the SCC condensation
    // into a single ring of bridge edges. Identical to the previous Phase
    // B/E logic — needed because pruning can disconnect the graph and the
    // wormhole pass that previously masked this is gone.
    {
        const adjArr: number[][] = adj.map((s) => [...s]);
        const { compId, numComps } = findStronglyConnectedComponents(N, adjArr);
        if (numComps > 1) {
            const byComp: number[][] = Array.from({ length: numComps }, () => []);
            for (let u = 1; u <= N; u++) byComp[compId[u]].push(u);
            function pickSender(c: number): number {
                for (const u of byComp[c]) if (adj[u].size < MAX_OUT) return u;
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
            }
        }
    }

    // Phase 5: swap adjacent warps for wormholes until diameter ≤ cap.
    // Each iteration: BFS double-sweep finds the diameter pair (p, q),
    // we add a bidi wormhole p↔q, then remove a hex-adjacent bidi pair
    // from somewhere "redundant" (not at the cap pair, not orphaning
    // anyone). This preserves the total edge count, so warpDist stays
    // intact in aggregate (individual sector degrees shift by ±1).
    //
    // Adjacency check is by hex distance against the cells array.
    {
        const diameterCap = Math.max(2, maxShortestPathFor(maxShortestPath, N));
        const hexDist = (a: HexCell, b: HexCell): number => {
            const dq = a.q - b.q;
            const dr = a.r - b.r;
            return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
        };
        const isAdjacent = (u: number, v: number): boolean =>
            hexDist(cells[u - 1], cells[v - 1]) === 1;

        // Stall limit is generous: stochastic BFS sometimes misses the true
        // periphery, and even successful swaps only shrink the diameter for
        // a subset of pairs. Bigger universes need many swaps.
        let stalled = 0;
        const MAX_STALL = 200;
        const MAX_ITERS = Math.max(1000, N * 2);
        for (let iter = 0; iter < MAX_ITERS && stalled < MAX_STALL; iter++) {
            // Multi-sample double-sweep diameter probe. More samples on
            // bigger graphs since each probe is a relatively cheap BFS but
            // the periphery is wider.
            const adjArr = adj.map((s) => [...s]);
            const SAMPLES = N >= 5000 ? 8 : 4;
            let bestU = -1;
            let bestV = -1;
            let bestDist = -1;
            for (let s = 0; s < SAMPLES; s++) {
                const seed = 1 + Math.floor(rng() * N);
                const sweep1 = bfsFarthest(N, adjArr, seed);
                const sweep2 = bfsFarthest(N, adjArr, sweep1.node);
                if (sweep2.dist > bestDist) {
                    bestDist = sweep2.dist;
                    bestU = sweep2.node;
                    bestV = sweep1.node;
                }
            }
            if (bestDist <= diameterCap) break;
            const p = bestU;
            const q = bestV;
            if (p === q || isAdjacent(p, q) || edges.has(`${p},${q}`)) {
                stalled++;
                continue;
            }

            // Add wormhole p↔q (bidi) if there's capacity.
            const canPQ = adj[p].size < MAX_OUT && inDeg[q] < MAX_IN;
            const canQP = adj[q].size < MAX_OUT && inDeg[p] < MAX_IN;
            if (!canPQ && !canQP) {
                stalled++;
                continue;
            }

            // Find an expendable hex-adjacent bidi pair to remove. Skip
            // edges touching p, q, or any forced hub (anchors keep their 6
            // out). Both endpoints must have in-degree AND out-degree ≥ 2
            // so removing the pair doesn't orphan either side (no zero-in,
            // no sink-only).
            const forcedSet = new Set(forcedHubSectors);
            let swapA = -1;
            let swapB = -1;
            for (let attempt = 0; attempt < 100; attempt++) {
                const a = 1 + Math.floor(rng() * N);
                if (a === p || a === q || forcedSet.has(a)) continue;
                if (adj[a].size < 2) continue;
                const neighbors = [...adj[a]];
                const b = neighbors[Math.floor(rng() * neighbors.length)];
                if (b === p || b === q || forcedSet.has(b)) continue;
                if (!isAdjacent(a, b)) continue;
                if (!edges.has(`${b},${a}`)) continue;
                if (inDeg[a] < 2 || inDeg[b] < 2) continue;
                if (adj[b].size < 2) continue;
                swapA = a;
                swapB = b;
                break;
            }
            if (swapA < 0) {
                stalled++;
                continue;
            }

            // Execute swap: remove the adjacent bidi pair, add the
            // wormhole, then verify SCC. Degree checks above aren't
            // sufficient to guarantee strong connectivity — roll back if
            // the swap broke it.
            removeEdge(swapA, swapB);
            removeEdge(swapB, swapA);
            let added = 0;
            if (canPQ && addEdge(p, q)) added++;
            if (canQP && addEdge(q, p)) added++;
            if (added === 0) {
                addEdge(swapA, swapB);
                addEdge(swapB, swapA);
                stalled++;
                continue;
            }
            // SCC check: every Phase-5 swap removes one local edge and adds
            // one long-range edge. The long-range add can't break SCC, but
            // the removal can. Cheap full Kosaraju is acceptable here
            // because Phase 5 runs at most ~MAX_STALL+swaps times.
            const sccAdj = adj.map((s) => [...s]);
            const { numComps } = findStronglyConnectedComponents(N, sccAdj);
            if (numComps > 1) {
                // Roll back wormhole AND restore adjacent pair.
                if (canPQ) removeEdge(p, q);
                if (canQP) removeEdge(q, p);
                addEdge(swapA, swapB);
                addEdge(swapB, swapA);
                stalled++;
                continue;
            }
            stalled = 0;
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
 * topological order of the condensation DAG. Iterative — handles N=1000+
 * without stack overflow.
 */
function findStronglyConnectedComponents(
    N: number,
    adj: number[][],
): { compId: Int32Array; numComps: number } {
    const visited = new Uint8Array(N + 1);
    const finishOrder: number[] = [];

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

    const radj: number[][] = Array.from({ length: N + 1 }, () => []);
    for (let u = 1; u <= N; u++) {
        for (const v of adj[u]) radj[v].push(u);
    }

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
 * Used by Phase 5's double-sweep diameter probe. Unreachable nodes are
 * treated as infinitely far so the swap loop bridges disconnected
 * fragments first (Phase 4 should have prevented this, but defensive).
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
    for (let i = 1; i <= N; i++) {
        if (dist[i] === -1) return { node: i, dist: Number.POSITIVE_INFINITY };
    }
    return { node: farthestNode, dist: farthestDist };
}

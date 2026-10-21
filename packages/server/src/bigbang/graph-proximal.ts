import type { GeneratedWarp, MaxShortestPath } from './types.js';
import { maxShortestPathFor } from './types.js';
import { HEX_NEIGHBOR_DIRS } from './positions.js';
import type { HexCell } from './positions.js';

const MAX_OUT = 6;
const MAX_IN = 6;

/** warpDist is 1-indexed (warpDist[1..6]); forced-hub sectors get MAX_OUT regardless. */
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

/** Subtractive warp generator: seed every hex-adjacent pair as bidi, prune to sampled out-degrees, rebalance the bidi ratio, stitch SCCs, then swap in wormholes until diameter ≤ cap. */
export function generateProximalGraph(
    N: number,
    twoWayPercentage: number,
    rng: () => number,
    cells: readonly HexCell[],
    forcedHubSectors: readonly number[],
    warpDist: number[],
    maxShortestPath: MaxShortestPath = 'medium',
    wormholesAlwaysTwoWay = true,
): GeneratedWarp[] {
    if (cells.length !== N) {
        throw new Error(`generateProximalGraph: expected ${N} cells, got ${cells.length}`);
    }
    const twoWayPct = Math.max(0, Math.min(100, twoWayPercentage));
    const targetOut = assignTargetOutDegrees(N, rng, warpDist, forcedHubSectors);

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

    // Phase 2: prune overfull sectors in descending-surplus order, re-ranked per
    // removal since each removal changes both endpoints' surplus.
    function surplus(s: number): number {
        return adj[s].size - targetOut[s];
    }
    const overfullQueue: number[] = [];
    for (let s = 1; s <= N; s++) if (surplus(s) > 0) overfullQueue.push(s);
    while (overfullQueue.length > 0) {
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
        // Prefer mutually-overfull neighbors (delete the bidi pair), else degrade
        // to 1-way; shuffled for spatial uniformity.
        const candidates = [...adj[u]];
        for (let i = candidates.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
        }
        let removed = false;
        for (const v of candidates) {
            if (surplus(v) <= 0) continue;
            removeEdge(u, v);
            if (edges.has(`${v},${u}`)) removeEdge(v, u);
            removed = true;
            break;
        }
        if (!removed) {
            for (const v of candidates) {
                removeEdge(u, v);
                // v→u is deliberately kept: the pair degrades to 1-way.
                removed = true;
                break;
            }
        }
        if (!removed) {
            // Defensive: unreachable while every targetOut ≥ 1.
            overfullQueue.splice(bestIdx, 1);
        }
    }

    // Phase 3: nudge the bidi/one-way ratio toward twoWayPct. Demotion skips an
    // edge whose removal would leave an endpoint at in-degree 0.
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
            // Promotion may push a sector past its warpDist target, capped only at MAX_OUT.
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

    // Phase 4: pruning can disconnect the graph — stitch the SCCs into a single
    // ring to restore strong connectivity.
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

    // Phase 5: swap hex-adjacent bidi pairs for long-range wormholes until
    // diameter ≤ cap; each swap preserves total edge count, so warpDist holds
    // in aggregate (individual degrees shift ±1).
    {
        const diameterCap = Math.max(2, maxShortestPathFor(maxShortestPath, N));
        const hexDist = (a: HexCell, b: HexCell): number => {
            const dq = a.q - b.q;
            const dr = a.r - b.r;
            return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
        };
        const isAdjacent = (u: number, v: number): boolean =>
            hexDist(cells[u - 1], cells[v - 1]) === 1;

        // Generous stall limit: the stochastic BFS probe can miss the true periphery.
        let stalled = 0;
        const MAX_STALL = 200;
        const MAX_ITERS = Math.max(1000, N * 2);
        for (let iter = 0; iter < MAX_ITERS && stalled < MAX_STALL; iter++) {
            // Multi-sample double-sweep: a single probe underestimates the diameter.
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

            // wormholesAlwaysTwoWay: skip the candidate rather than ship a one-way wormhole.
            const canPQ = adj[p].size < MAX_OUT && inDeg[q] < MAX_IN;
            const canQP = adj[q].size < MAX_OUT && inDeg[p] < MAX_IN;
            if (!canPQ && !canQP) {
                stalled++;
                continue;
            }
            if (wormholesAlwaysTwoWay && !(canPQ && canQP)) {
                stalled++;
                continue;
            }

            // Removal candidates must avoid p, q, and forced hubs, and both
            // endpoints need in- AND out-degree ≥ 2 so neither side is orphaned.
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

            // Degree checks don't guarantee strong connectivity — verify SCC
            // after the swap and roll back on failure.
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
            const sccAdj = adj.map((s) => [...s]);
            const { numComps } = findStronglyConnectedComponents(N, sccAdj);
            if (numComps > 1) {
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

/** Iterative Kosaraju (no stack overflow at N=1000+); compId is 1-indexed and SCCs are numbered in condensation topological order. */
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

/** Farthest node from src by BFS; unreachable nodes count as infinitely far so disconnected fragments get bridged first. */
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

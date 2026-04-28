import type { GeneratedWarp } from './types.js';
import { DEFAULT_WARP_DIST } from './types.js';
import type { Position } from './positions.js';

const MAX_OUT = 6;
const MAX_IN = 6;

/**
 * Generate a warp graph whose edges prefer nearby sectors in a bounded 2D
 * plane. Nodes are indexed 1..N with `positions[i-1]` giving the position of
 * sector i.
 *
 * Connectivity backbone: a budget-aware spanning tree rooted at sector 1.
 * Each non-root node accepts up to (targetOut - 1) children — its last
 * out-slot is reserved for a *back-edge to parent*, which automatically
 * forms a two-way pair. This means a degree-1 leaf becomes a round-trip
 * dead-end (one warp in via parent, one warp out back to parent) without
 * any post-hoc bumping of the requested degree distribution. Earlier the
 * Phase-A backbone was a Hamiltonian cycle, which forced every node —
 * including dead-end candidates — to spend its only out-slot on the cycle,
 * leaving nothing free for pair-forming.
 */
export function generateProximalGraph(
    N: number,
    twoWayPercentage: number,
    rng: () => number,
    positions: Position[],
    warpDist: number[] = DEFAULT_WARP_DIST,
    forcedMaxOutSectors: readonly number[] = [],
): GeneratedWarp[] {
    if (positions.length !== N) {
        throw new Error(`generateProximalGraph: expected ${N} positions, got ${positions.length}`);
    }

    const targetOut = assignTargetOutDegrees(N, twoWayPercentage, rng, warpDist);
    // Hard-override after random assignment so callers can guarantee certain
    // landmark sectors (e.g. Federation HQ + Starbase) always have the full
    // MAX_OUT regardless of the configured warp distribution.
    for (const sid of forcedMaxOutSectors) {
        if (sid >= 1 && sid <= N) targetOut[sid] = MAX_OUT;
    }
    let totalEdges = 0;
    for (let i = 1; i <= N; i++) totalEdges += targetOut[i];

    if (twoWayPercentage >= 99 && totalEdges % 2 !== 0) {
        for (let i = 1; i <= N; i++) {
            if (targetOut[i] < MAX_OUT) {
                targetOut[i]++;
                totalEdges++;
                break;
            }
        }
    }

    const TOLERANCE = 5.0;
    function findBiPairs(total: number): number {
        const base = Math.round((total * twoWayPercentage) / 200);
        for (const bp of [base, base - 1, base + 1]) {
            if (bp < 0 || 2 * bp > total) continue;
            const pct = ((2 * bp) / total) * 100;
            if (Math.abs(pct - twoWayPercentage) <= TOLERANCE) return bp;
        }
        return -1;
    }
    let biPairsTarget = findBiPairs(totalEdges);
    while (biPairsTarget < 0) {
        for (let i = 1; i <= N; i++) {
            if (targetOut[i] < MAX_OUT) {
                targetOut[i]++;
                totalEdges++;
                break;
            }
        }
        biPairsTarget = findBiPairs(totalEdges);
    }

    // Tree-feasibility: each non-root needs a parent (consumes 1 of the
    // parent's out-slots). Reserving 1 slot per non-root for a back-edge
    // means each parent can adopt at most (targetOut - 1) children. The sum
    // of (targetOut - 1) across all nodes must be ≥ N-1 for a connected
    // tree to exist with back-edges everywhere; equivalently, totalEdges ≥
    // 2N - 1. If a user picks a too-sparse distribution we relax the
    // back-edge reservation rather than fail.
    const reserveBackEdge = totalEdges >= 2 * N - 1;

    // Precompute k-nearest-neighbors for each node, sorted by distance.
    const K = Math.min(40, N - 1);
    const knn = buildKNN(N, positions, K);

    for (let attempt = 0; attempt < 200; attempt++) {
        const outDeg = new Int32Array(N + 1);
        const inDeg = new Int32Array(N + 1);
        const edges = new Set<string>();

        function addEdge(u: number, v: number): boolean {
            const key = `${u},${v}`;
            if (edges.has(key)) return false;
            edges.add(key);
            outDeg[u]++;
            inDeg[v]++;
            return true;
        }

        // Phase A: budget-aware spanning tree from sector 1. Each parent
        // can adopt up to (targetOut - reserveSlot) children.
        const parent = new Int32Array(N + 1).fill(0);
        parent[1] = -1;
        const treeBudget = new Int32Array(N + 1);
        for (let i = 1; i <= N; i++) {
            treeBudget[i] = targetOut[i] - (reserveBackEdge ? 1 : 0);
            if (treeBudget[i] < 0) treeBudget[i] = 0;
        }
        // Root has no parent → no back-edge reservation needed there.
        if (reserveBackEdge) treeBudget[1] = targetOut[1];

        const inTree = new Uint8Array(N + 1);
        inTree[1] = 1;
        let treeSize = 1;

        // Prim's algorithm with maintained "best in-tree neighbor with
        // budget" per out-of-tree node. Pure O(N²) — no priority queue, no
        // fallback global rescan.
        const distToTree = new Float64Array(N + 1).fill(Infinity);
        const nearestInTree = new Int32Array(N + 1);
        // Initialize from root.
        for (let c = 2; c <= N; c++) {
            const dx = positions[0].x - positions[c - 1].x;
            const dy = positions[0].y - positions[c - 1].y;
            distToTree[c] = dx * dx + dy * dy;
            nearestInTree[c] = 1;
        }

        while (treeSize < N) {
            // Pick the closest out-of-tree node whose nearest in-tree
            // partner still has budget. If a candidate's nearest has run
            // out of budget, recompute that candidate's nearest from
            // scratch — this is rare so the amortized cost stays O(N²).
            let bestC = -1;
            let bestD = Infinity;
            for (let c = 2; c <= N; c++) {
                if (inTree[c]) continue;
                if (treeBudget[nearestInTree[c]] <= 0) {
                    // Stale: rescan in-tree nodes for a budgeted parent.
                    let nd = Infinity;
                    let np = -1;
                    for (let p = 1; p <= N; p++) {
                        if (!inTree[p] || treeBudget[p] <= 0) continue;
                        const dx = positions[p - 1].x - positions[c - 1].x;
                        const dy = positions[p - 1].y - positions[c - 1].y;
                        const d = dx * dx + dy * dy;
                        if (d < nd) {
                            nd = d;
                            np = p;
                        }
                    }
                    if (np === -1) {
                        // No budgeted parent exists for this child — the
                        // tree can't span. Fall through; outer guard will
                        // detect treeSize < N and retry.
                        distToTree[c] = Infinity;
                        nearestInTree[c] = 0;
                        continue;
                    }
                    distToTree[c] = nd;
                    nearestInTree[c] = np;
                }
                if (distToTree[c] < bestD) {
                    bestD = distToTree[c];
                    bestC = c;
                }
            }
            if (bestC === -1) break;

            const newParent = nearestInTree[bestC];
            parent[bestC] = newParent;
            treeBudget[newParent]--;
            addEdge(newParent, bestC);
            inTree[bestC] = 1;
            treeSize++;

            // Relax: maybe bestC is now closer to remaining out-of-tree
            // nodes than their current nearestInTree.
            for (let c = 2; c <= N; c++) {
                if (inTree[c]) continue;
                const dx = positions[bestC - 1].x - positions[c - 1].x;
                const dy = positions[bestC - 1].y - positions[c - 1].y;
                const d = dx * dx + dy * dy;
                if (d < distToTree[c]) {
                    distToTree[c] = d;
                    nearestInTree[c] = bestC;
                }
            }
        }
        if (treeSize < N) continue;

        // Phase B: place back-edges child → parent for every non-root.
        // Each becomes a two-way pair with the corresponding tree edge.
        // Skip if either endpoint is at its limit (MAX_IN for parent, or
        // out-budget for child after later fills — though here outDeg[c]
        // is still 0 so it's always free).
        let pairsPlaced = 0;
        // Order back-edge placement by leaf-first so degree-1 leaves are
        // guaranteed their pair before slot pressure builds up.
        const backOrder = Array.from({ length: N - 1 }, (_, i) => i + 2);
        backOrder.sort((a, b) => targetOut[a] - targetOut[b]);
        for (const c of backOrder) {
            const p = parent[c];
            if (p < 0) continue;
            if (outDeg[c] >= targetOut[c]) continue;
            if (inDeg[p] >= MAX_IN) continue;
            if (addEdge(c, p)) pairsPlaced++;
        }

        // Phase C: any further pairs needed to hit biPairsTarget come from
        // KNN scans, exactly like the old fill pass 1.
        let biPairsNeeded = biPairsTarget - pairsPlaced;
        if (biPairsNeeded > 0) {
            const order = Array.from({ length: N }, (_, i) => i + 1);
            let stalled = 0;
            while (biPairsNeeded > 0 && stalled < 3) {
                shuffle(order, rng);
                let placed = false;
                for (const u of order) {
                    if (biPairsNeeded <= 0) break;
                    if (outDeg[u] >= targetOut[u]) continue;
                    for (const v of knn[u]) {
                        if (v === u) continue;
                        if (edges.has(`${u},${v}`)) continue;
                        if (inDeg[v] >= MAX_IN) continue;
                        const reverseExists = edges.has(`${v},${u}`);
                        if (reverseExists) {
                            addEdge(u, v);
                            biPairsNeeded--;
                            placed = true;
                            break;
                        } else if (outDeg[v] < targetOut[v] && inDeg[u] < MAX_IN) {
                            addEdge(u, v);
                            addEdge(v, u);
                            biPairsNeeded--;
                            placed = true;
                            break;
                        }
                    }
                }
                if (!placed) stalled++;
                else stalled = 0;
            }
        }
        if (biPairsNeeded > 0) continue;

        // Phase D: fill remaining out-slots with one-way edges.
        let allFilled = true;
        for (let u = 1; u <= N; u++) {
            if (outDeg[u] >= targetOut[u]) continue;
            for (const v of knn[u]) {
                if (outDeg[u] >= targetOut[u]) break;
                if (v === u) continue;
                if (edges.has(`${u},${v}`)) continue;
                if (edges.has(`${v},${u}`)) continue; // avoid accidental bi
                if (inDeg[v] >= MAX_IN) continue;
                addEdge(u, v);
            }
            if (outDeg[u] < targetOut[u]) {
                let tries = 0;
                while (outDeg[u] < targetOut[u]) {
                    if (tries++ > N * 5 + 200) {
                        allFilled = false;
                        break;
                    }
                    const v = Math.floor(rng() * N) + 1;
                    if (v === u) continue;
                    if (edges.has(`${u},${v}`)) continue;
                    if (edges.has(`${v},${u}`)) continue;
                    if (inDeg[v] >= MAX_IN) continue;
                    addEdge(u, v);
                }
                if (!allFilled) break;
            }
        }
        if (!allFilled) continue;

        // Validate degree sums and two-way percentage.
        let valid = true;
        for (let i = 1; i <= N; i++) {
            if (outDeg[i] !== targetOut[i] || inDeg[i] < 1 || inDeg[i] > MAX_IN) {
                valid = false;
                break;
            }
        }
        if (!valid) continue;

        let biCount = 0;
        for (const e of edges) {
            const comma = e.indexOf(',');
            const a = e.substring(0, comma);
            const b = e.substring(comma + 1);
            if (edges.has(`${b},${a}`)) biCount++;
        }
        const actualPct = (biCount / edges.size) * 100;
        if (Math.abs(actualPct - twoWayPercentage) > TOLERANCE) continue;

        const result: GeneratedWarp[] = [];
        for (const e of edges) {
            const comma = e.indexOf(',');
            result.push({
                from: parseInt(e.substring(0, comma), 10),
                to: parseInt(e.substring(comma + 1), 10),
            });
        }
        result.sort((a, b) => {
            if (a.from !== b.from) return a.from - b.from;
            return a.to - b.to;
        });
        return result;
    }
    throw new Error('Failed to generate proximal graph after 200 attempts.');
}

function assignTargetOutDegrees(
    N: number,
    T: number,
    rng: () => number,
    warpDist: number[],
): Int32Array {
    const targetOut = new Int32Array(N + 1);
    const cumDist = new Float64Array(MAX_OUT + 1);
    let pctSum = 0;
    for (let d = 1; d <= MAX_OUT; d++) {
        pctSum += warpDist[d];
        cumDist[d] = pctSum;
    }
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
    if (T >= 99) {
        for (let i = 1; i <= N; i++) {
            if (targetOut[i] < 2) targetOut[i] = 2;
        }
    }
    return targetOut;
}

/** For each node i (1-indexed), return a list of `K` neighbor ids sorted by distance. */
function buildKNN(N: number, positions: { x: number; y: number }[], K: number): number[][] {
    const result: number[][] = [[]];
    for (let i = 1; i <= N; i++) {
        const pi = positions[i - 1];
        const entries: { id: number; d: number }[] = [];
        for (let j = 1; j <= N; j++) {
            if (j === i) continue;
            const pj = positions[j - 1];
            const dx = pi.x - pj.x;
            const dy = pi.y - pj.y;
            const d = dx * dx + dy * dy;
            entries.push({ id: j, d });
        }
        entries.sort((a, b) => a.d - b.d);
        const take = Math.min(K, entries.length);
        const row: number[] = new Array(take);
        for (let k = 0; k < take; k++) row[k] = entries[k].id;
        result.push(row);
    }
    return result;
}

function shuffle<T>(arr: T[], rng: () => number): void {
    for (let k = arr.length - 1; k > 0; k--) {
        const j = Math.floor(rng() * (k + 1));
        [arr[k], arr[j]] = [arr[j], arr[k]];
    }
}

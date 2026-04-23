import type { GeneratedWarp } from './types.js';
import { DEFAULT_WARP_DIST } from './types.js';
import type { Position } from './positions.js';

const MAX_OUT = 6;
const MAX_IN = 6;

/**
 * Generate a warp graph whose edges prefer nearby sectors in a bounded 2D
 * plane. Nodes are indexed 1..N with `positions[i-1]` giving the position of
 * sector i. Satisfies the same degree-distribution and two-way percentage
 * guarantees as `generateGraph`, plus weak connectivity from sector 1.
 */
export function generateProximalGraph(
    N: number,
    T: number,
    rng: () => number,
    positions: Position[],
    warpDist: number[] = DEFAULT_WARP_DIST,
): GeneratedWarp[] {
    if (positions.length !== N) {
        throw new Error(`generateProximalGraph: expected ${N} positions, got ${positions.length}`);
    }

    const targetOut = assignTargetOutDegrees(N, T, rng, warpDist);
    let totalEdges = 0;
    for (let i = 1; i <= N; i++) totalEdges += targetOut[i];

    if (T >= 99 && totalEdges % 2 !== 0) {
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
        const base = Math.round((total * T) / 200);
        for (const bp of [base, base - 1, base + 1]) {
            if (bp < 0 || 2 * bp > total) continue;
            const pct = ((2 * bp) / total) * 100;
            if (Math.abs(pct - T) <= TOLERANCE) return bp;
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

    if (T < 99) {
        const minMargin = Math.max(5, Math.ceil(N * 0.02));
        function getMargin(): number {
            let d1 = 0;
            for (let i = 1; i <= N; i++) if (targetOut[i] === 1) d1++;
            const remaining = totalEdges - N;
            const maxPhaseB = N - d1;
            return Math.floor((remaining + maxPhaseB) / 2) - biPairsTarget;
        }
        for (let targetDeg = 1; targetDeg < MAX_OUT && getMargin() < minMargin; targetDeg++) {
            for (let i = 1; i <= N && getMargin() < minMargin; i++) {
                if (targetOut[i] === targetDeg) {
                    targetOut[i]++;
                    totalEdges++;
                    const bp = findBiPairs(totalEdges);
                    if (bp >= 0) biPairsTarget = bp;
                }
            }
        }
    }

    // Precompute k-nearest-neighbors for each node, sorted by distance.
    const K = Math.min(40, N - 1);
    const knn = buildKNN(N, positions, K);

    for (let attempt = 0; attempt < 200; attempt++) {
        const outDeg = new Int32Array(N + 1);
        const inDeg = new Int32Array(N + 1);
        const edges = new Set<string>();

        function addEdge(u: number, v: number) {
            edges.add(`${u},${v}`);
            outDeg[u]++;
            inDeg[v]++;
        }

        // Phase A: Hamiltonian cycle via greedy nearest-neighbor tour from
        // sector 1. Resulting cycle edges are short and guarantee weak
        // connectivity.
        const perm = nearestNeighborTour(N, positions, 1);
        for (let i = 0; i < N; i++) {
            addEdge(perm[i], perm[(i + 1) % N]);
        }

        // Phase B: flip some cycle edges to bidirectional.
        let biPairsPlaced = 0;
        const cycleIdx = Array.from({ length: N }, (_, i) => i);
        shuffle(cycleIdx, rng);
        for (const ci of cycleIdx) {
            if (biPairsPlaced >= biPairsTarget) break;
            const u = perm[ci];
            const v = perm[(ci + 1) % N];
            if (outDeg[v] < targetOut[v] && inDeg[u] < MAX_IN) {
                addEdge(v, u);
                biPairsPlaced++;
            }
        }

        let biPairsNeeded = biPairsTarget - biPairsPlaced;

        // Fill pass 1: bidirectional pairs. Walk each node's KNN list to find
        // a short, feasible target. Loops until no placement is possible.
        if (biPairsNeeded > 0) {
            const order = Array.from({ length: N }, (_, i) => i + 1);
            let stalled = 0;
            while (biPairsNeeded > 0 && stalled < 3) {
                shuffle(order, rng);
                let placed = false;
                for (const u of order) {
                    if (biPairsNeeded <= 0) break;
                    if (outDeg[u] >= targetOut[u]) continue;
                    const candidates = knn[u];
                    for (const v of candidates) {
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

        // Fill pass 2: unidirectional edges, preferring nearby candidates.
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
            // Fallback: expand beyond KNN if still under target.
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
        if (Math.abs(actualPct - T) > TOLERANCE) continue;

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
    // Each node's KNN: initial pass stores (dist, id) in a heap-ish max-heap of size K.
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

/** Greedy nearest-neighbor Hamiltonian tour starting from `start`. */
function nearestNeighborTour(
    N: number,
    positions: { x: number; y: number }[],
    start: number,
): number[] {
    const visited = new Uint8Array(N + 1);
    const tour: number[] = new Array(N);
    let current = start;
    visited[current] = 1;
    tour[0] = current;
    for (let step = 1; step < N; step++) {
        const pc = positions[current - 1];
        let best = -1;
        let bestD = Infinity;
        for (let j = 1; j <= N; j++) {
            if (visited[j]) continue;
            const pj = positions[j - 1];
            const dx = pc.x - pj.x;
            const dy = pc.y - pj.y;
            const d = dx * dx + dy * dy;
            if (d < bestD) {
                bestD = d;
                best = j;
            }
        }
        visited[best] = 1;
        tour[step] = best;
        current = best;
    }
    return tour;
}

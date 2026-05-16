import type { GeneratedWarp } from './types.js';

export function generateGraph(
    N: number,
    T: number,
    rng: () => number,
    warpDist: number[],
    forcedMaxOutSectors: readonly number[] = [],
): GeneratedWarp[] {
    const MAX_OUT = 6;
    const MAX_IN = 6;

    // Assign target out-degrees from distribution
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

    // Hard-override landmark sectors (e.g. Federation HQ + Starbase) so they
    // always emit MAX_OUT warps regardless of the configured distribution.
    for (const sid of forcedMaxOutSectors) {
        if (sid >= 1 && sid <= N) targetOut[sid] = MAX_OUT;
    }

    // For T >= 99: bump degree-1 nodes to 2 so full bidirectional is possible
    if (T >= 99) {
        for (let i = 1; i <= N; i++) {
            if (targetOut[i] < 2) targetOut[i] = 2;
        }
    }

    let totalEdges = 0;
    for (let i = 1; i <= N; i++) totalEdges += targetOut[i];

    // For T >= 99: ensure even total so 100% bidirectional is achievable
    if (T >= 99 && totalEdges % 2 !== 0) {
        for (let i = 1; i <= N; i++) {
            if (targetOut[i] < MAX_OUT) {
                targetOut[i]++;
                totalEdges++;
                break;
            }
        }
    }

    // Find biPairsTarget that gives pct within TOLERANCE of T. Small graphs need
    // slack because integer bp values can't hit arbitrary percentages cleanly.
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

    // Budget feasibility: Phase B can make at most (N - degree1count) bi pairs
    // costing 1 unit each; fill phase costs 2 per expensive bi pair.
    // When tight, bump lowest-degree nodes to increase budget.
    // Skip for T >= 99 — the earlier T>=99 bump already ensures feasibility.
    if (T < 99) {
        const minMargin = Math.max(5, Math.ceil(N * 0.02));

        function getMargin(): number {
            let d1 = 0;
            for (let i = 1; i <= N; i++) if (targetOut[i] === 1) d1++;
            const remaining = totalEdges - N;
            const maxPhaseB = N - d1;
            return Math.floor((remaining + maxPhaseB) / 2) - biPairsTarget;
        }

        // Bump degree-1 nodes first, then degree-2, etc.
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
    } // end T < 99 budget check

    // Retry loop
    for (let attempt = 0; ; attempt++) {
        if (attempt > 2000) {
            throw new Error('Failed to generate graph after 2000 attempts.');
        }

        const outDeg = new Int32Array(N + 1);
        const inDeg = new Int32Array(N + 1);
        const edges = new Set<string>();

        function addEdge(u: number, v: number) {
            edges.add(`${u},${v}`);
            outDeg[u]++;
            inDeg[v]++;
        }

        // Phase A: Hamiltonian cycle for connectivity
        const perm = Array.from({ length: N }, (_, i) => i + 1);
        for (let k = perm.length - 1; k > 0; k--) {
            const j = Math.floor(rng() * (k + 1));
            [perm[k], perm[j]] = [perm[j], perm[k]];
        }
        for (let i = 0; i < N; i++) {
            addEdge(perm[i], perm[(i + 1) % N]);
        }

        // Phase B: Make some cycle edges bidirectional
        let biPairsPlaced = 0;
        const cycleIdx = Array.from({ length: N }, (_, i) => i);
        for (let k = cycleIdx.length - 1; k > 0; k--) {
            const j = Math.floor(rng() * (k + 1));
            [cycleIdx[k], cycleIdx[j]] = [cycleIdx[j], cycleIdx[k]];
        }
        for (const ci of cycleIdx) {
            if (biPairsPlaced >= biPairsTarget) break;
            const u = perm[ci];
            const v = perm[(ci + 1) % N];
            if (outDeg[v] < targetOut[v] && inDeg[u] < MAX_IN) {
                addEdge(v, u);
                biPairsPlaced++;
            }
        }

        // Fill phase: two passes to ensure bi pairs get first claim on budget
        let biPairsNeeded = biPairsTarget - biPairsPlaced;

        // Pass 1: Add bidirectional pairs only (expensive: both new, or cheap: reverse exists)
        if (biPairsNeeded > 0) {
            let pool: number[] = [];
            for (let i = 1; i <= N; i++) {
                if (outDeg[i] < targetOut[i]) pool.push(i);
            }

            let stalled = 0;
            while (biPairsNeeded > 0 && stalled < 3) {
                let tries = 0;
                let placed = false;
                const limit = pool.length * 5 + 200;
                while (tries++ < limit) {
                    const u = pool[Math.floor(rng() * pool.length)];
                    if (outDeg[u] >= targetOut[u]) continue;
                    const v = Math.floor(rng() * N) + 1;
                    if (v === u) continue;
                    if (edges.has(`${u},${v}`)) continue;
                    if (inDeg[v] >= MAX_IN) continue;

                    const reverseExists = edges.has(`${v},${u}`);
                    if (reverseExists) {
                        // Cheap bi: just add u→v
                        addEdge(u, v);
                        biPairsNeeded--;
                        placed = true;
                        break;
                    } else if (outDeg[v] < targetOut[v] && inDeg[u] < MAX_IN) {
                        // Expensive bi: add both directions
                        addEdge(u, v);
                        addEdge(v, u);
                        biPairsNeeded--;
                        placed = true;
                        break;
                    }
                }
                if (!placed) stalled++;
                else stalled = 0;

                // Rebuild pool periodically
                if (biPairsNeeded > 0 && biPairsNeeded % 200 === 0) {
                    pool = [];
                    for (let i = 1; i <= N; i++) {
                        if (outDeg[i] < targetOut[i]) pool.push(i);
                    }
                    if (pool.length < 2) break;
                }
            }
        }
        if (biPairsNeeded > 0) continue;

        // Pass 2: Fill remaining degree targets with unidirectional edges
        let allFilled = true;
        for (let i = 1; i <= N; i++) {
            let tries = 0;
            while (outDeg[i] < targetOut[i]) {
                if (tries++ > N * 5 + 200) {
                    allFilled = false;
                    break;
                }
                const v = Math.floor(rng() * N) + 1;
                if (v === i) continue;
                if (edges.has(`${i},${v}`)) continue;
                if (edges.has(`${v},${i}`)) continue; // avoid accidental bi pair
                if (inDeg[v] >= MAX_IN) continue;
                addEdge(i, v);
            }
            if (!allFilled) break;
        }
        if (!allFilled) continue;

        // Validate
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
}

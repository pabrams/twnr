import type { GeneratedWarp } from './types.js';

export function generateGraph(N: number, T: number, rng: () => number): GeneratedWarp[] {
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

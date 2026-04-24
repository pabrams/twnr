import { PROXIMAL_PLANE_SIZE } from './types.js';
import type { Position } from './positions.js';

export interface LayoutEdge {
    a: number; // 0-indexed sector index
    b: number; // 0-indexed sector index
}

/**
 * Fruchterman-Reingold force-directed layout with a Barnes-Hut quadtree for
 * repulsion. Repulsion is approximated at O(N log N) per iteration; attraction
 * runs along warp edges in O(E). Edges are treated as undirected (one spring
 * per unordered pair, regardless of one-way/two-way).
 *
 * Complexity: O(iters * (N log N + E)).
 */
export function fruchtermanReingold(
    initial: Position[],
    edges: LayoutEdge[],
    rng: () => number,
    options: {
        size?: number;
        iterations?: number;
        initialTemperature?: number;
        /** Barnes-Hut opening angle. Smaller = more accurate + slower. Default 1.0. */
        theta?: number;
    } = {},
): Position[] {
    const N = initial.length;
    if (N < 2) return initial.map((p) => ({ x: p.x, y: p.y }));

    const size = options.size ?? PROXIMAL_PLANE_SIZE;
    const iterations = options.iterations ?? 150;
    const theta = options.theta ?? 1.0;
    const thetaSq = theta * theta;
    const area = size * size;
    const k = Math.sqrt(area / N);
    const kSq = k * k;

    // Positions stored in parallel Float64 arrays for cache-friendly access
    // during the inner loops.
    const posX = new Float64Array(N);
    const posY = new Float64Array(N);
    for (let i = 0; i < N; i++) {
        posX[i] = initial[i].x;
        posY[i] = initial[i].y;
    }

    // Dedupe edges into unique unordered pairs.
    const seen = new Set<string>();
    const edgeA: number[] = [];
    const edgeB: number[] = [];
    for (const e of edges) {
        if (e.a === e.b) continue;
        const lo = Math.min(e.a, e.b);
        const hi = Math.max(e.a, e.b);
        const key = `${lo},${hi}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edgeA.push(lo);
        edgeB.push(hi);
    }
    const E = edgeA.length;

    const dispX = new Float64Array(N);
    const dispY = new Float64Array(N);

    // ---- Quadtree (flat typed arrays, reused across iterations) ----
    // Each node entry holds center of its bbox, half side length, mass (point
    // count), accumulated centroid sums (comSumX/Y; divide by mass for the
    // centroid), four child indices, and a point index (>= 0 iff this node is
    // a leaf with a single point). Internal nodes have pointIdx = -1.
    let capacity = Math.max(16, N * 4);
    let nodeCx = new Float64Array(capacity);
    let nodeCy = new Float64Array(capacity);
    let nodeHalf = new Float64Array(capacity);
    let nodeMass = new Float64Array(capacity);
    let nodeComSumX = new Float64Array(capacity);
    let nodeComSumY = new Float64Array(capacity);
    let nodeChildren = new Int32Array(capacity * 4);
    let nodePointIdx = new Int32Array(capacity);
    let nodeCount = 0;

    function growCapacity(): void {
        const newCap = capacity * 2;
        const grow = (src: Float64Array) => {
            const dst = new Float64Array(newCap);
            dst.set(src);
            return dst;
        };
        const growI = (src: Int32Array, factor = 1) => {
            const dst = new Int32Array(newCap * factor);
            dst.set(src);
            return dst;
        };
        nodeCx = grow(nodeCx);
        nodeCy = grow(nodeCy);
        nodeHalf = grow(nodeHalf);
        nodeMass = grow(nodeMass);
        nodeComSumX = grow(nodeComSumX);
        nodeComSumY = grow(nodeComSumY);
        nodeChildren = growI(nodeChildren, 4);
        nodePointIdx = growI(nodePointIdx);
        capacity = newCap;
    }

    function allocNode(cx: number, cy: number, halfSize: number): number {
        if (nodeCount === capacity) growCapacity();
        const id = nodeCount++;
        nodeCx[id] = cx;
        nodeCy[id] = cy;
        nodeHalf[id] = halfSize;
        nodeMass[id] = 0;
        nodeComSumX[id] = 0;
        nodeComSumY[id] = 0;
        nodePointIdx[id] = -1;
        const base = id * 4;
        nodeChildren[base] = -1;
        nodeChildren[base + 1] = -1;
        nodeChildren[base + 2] = -1;
        nodeChildren[base + 3] = -1;
        return id;
    }

    const MAX_DEPTH = 40;

    /**
     * Iterative insertion of `pointIdx` starting at `root`. Written as a loop
     * rather than recursion so extreme depths (two points pushed very close by
     * forces) can't blow the JS call stack.
     */
    function insert(root: number, pointIdx: number): void {
        let node = root;
        let depth = 0;
        let px = posX[pointIdx];
        let py = posY[pointIdx];

        while (true) {
            // Empty cell: become a leaf holding this point.
            if (nodeMass[node] === 0) {
                nodePointIdx[node] = pointIdx;
                nodeMass[node] = 1;
                nodeComSumX[node] = px;
                nodeComSumY[node] = py;
                return;
            }

            // Leaf cell: split it and push the existing point down, then loop
            // to place the new point. Stops subdividing past MAX_DEPTH and
            // buckets the new point into the centroid instead.
            if (nodePointIdx[node] >= 0) {
                const existingIdx = nodePointIdx[node];
                const ex = posX[existingIdx];
                const ey = posY[existingIdx];

                if (depth >= MAX_DEPTH) {
                    // Bucket leaf: two points share this cell because the
                    // tree can't separate them any further. Accept the
                    // approximation — the centroid covers both.
                    nodeComSumX[node] += px;
                    nodeComSumY[node] += py;
                    nodeMass[node] += 1;
                    return;
                }

                if (Math.abs(ex - px) < 1e-6 && Math.abs(ey - py) < 1e-6) {
                    // Coincident: jitter the new point so subdivision can
                    // actually separate them.
                    px += (rng() - 0.5) * 0.5;
                    py += (rng() - 0.5) * 0.5;
                    posX[pointIdx] = px;
                    posY[pointIdx] = py;
                }

                // Convert leaf → internal. comSum/mass already reflect the
                // existing point; we'll accumulate the new point below.
                nodePointIdx[node] = -1;

                const cx = nodeCx[node];
                const cy = nodeCy[node];
                const childHalf = nodeHalf[node] * 0.5;
                const base = node * 4;

                // Place the existing point into its quadrant.
                const qe = (ex >= cx ? 1 : 0) + (ey >= cy ? 2 : 0);
                const childE = allocNode(
                    cx + (qe & 1 ? childHalf : -childHalf),
                    cy + (qe & 2 ? childHalf : -childHalf),
                    childHalf,
                );
                nodeChildren[base + qe] = childE;
                nodePointIdx[childE] = existingIdx;
                nodeMass[childE] = 1;
                nodeComSumX[childE] = ex;
                nodeComSumY[childE] = ey;
                // Fall through to the internal-node branch below.
            }

            // Internal cell: accumulate new point and descend into its child.
            nodeComSumX[node] += px;
            nodeComSumY[node] += py;
            nodeMass[node] += 1;

            const cx = nodeCx[node];
            const cy = nodeCy[node];
            const q = (px >= cx ? 1 : 0) + (py >= cy ? 2 : 0);
            const base = node * 4;
            let child = nodeChildren[base + q];
            if (child === -1) {
                const childHalf = nodeHalf[node] * 0.5;
                child = allocNode(
                    cx + (q & 1 ? childHalf : -childHalf),
                    cy + (q & 2 ? childHalf : -childHalf),
                    childHalf,
                );
                nodeChildren[base + q] = child;
            }
            node = child;
            depth++;
        }
    }

    function buildTree(): number {
        nodeCount = 0;
        const root = allocNode(size / 2, size / 2, size / 2);
        for (let i = 0; i < N; i++) {
            insert(root, i);
        }
        return root;
    }

    // Iterative Barnes-Hut force walk for point `i`. Uses an explicit Int32
    // stack (reused across queries) instead of recursion: opening criterion is
    // (2·halfSize)² < θ² · distSq — if the node is distant enough we treat its
    // mass as a single point at its centroid, otherwise we push its children
    // onto the stack.
    const walkStack = new Int32Array(capacity);
    let walkStackRef = walkStack; // rebound when capacity grows
    function accumulateRepulsion(i: number, root: number): void {
        const pi = posX[i];
        const pj = posY[i];
        let stack = walkStackRef;
        if (stack.length < capacity) {
            stack = new Int32Array(capacity);
            walkStackRef = stack;
        }
        let top = 0;
        stack[top++] = root;
        let ax = 0;
        let ay = 0;
        while (top > 0) {
            const node = stack[--top];
            const mass = nodeMass[node];
            if (mass === 0) continue;
            if (nodePointIdx[node] === i) continue;

            const comX = nodeComSumX[node] / mass;
            const comY = nodeComSumY[node] / mass;
            let dx = pi - comX;
            let dy = pj - comY;
            let distSq = dx * dx + dy * dy;
            if (distSq < 1e-6) {
                dx = rng() - 0.5;
                dy = rng() - 0.5;
                distSq = dx * dx + dy * dy;
            }

            const cellSide = nodeHalf[node] * 2;
            const cellSideSq = cellSide * cellSide;
            const isLeaf = nodePointIdx[node] >= 0;
            if (isLeaf || cellSideSq < thetaSq * distSq) {
                const dist = Math.sqrt(distSq);
                const force = (kSq * mass) / dist;
                ax += (dx / dist) * force;
                ay += (dy / dist) * force;
                continue;
            }

            const base = node * 4;
            const c0 = nodeChildren[base];
            const c1 = nodeChildren[base + 1];
            const c2 = nodeChildren[base + 2];
            const c3 = nodeChildren[base + 3];
            if (c0 !== -1) stack[top++] = c0;
            if (c1 !== -1) stack[top++] = c1;
            if (c2 !== -1) stack[top++] = c2;
            if (c3 !== -1) stack[top++] = c3;
        }
        dispX[i] += ax;
        dispY[i] += ay;
    }

    let temperature = options.initialTemperature ?? size / 10;
    const cooling = temperature / iterations;

    for (let iter = 0; iter < iterations; iter++) {
        for (let i = 0; i < N; i++) {
            dispX[i] = 0;
            dispY[i] = 0;
        }

        const root = buildTree();
        for (let i = 0; i < N; i++) {
            accumulateRepulsion(i, root);
        }

        // Attractive forces along edges: F = d²/k (pull toward neighbour).
        for (let e = 0; e < E; e++) {
            const a = edgeA[e];
            const b = edgeB[e];
            const dx = posX[a] - posX[b];
            const dy = posY[a] - posY[b];
            const distSq = dx * dx + dy * dy;
            if (distSq < 0.01) continue;
            const dist = Math.sqrt(distSq);
            const force = distSq / k;
            const ux = dx / dist;
            const uy = dy / dist;
            dispX[a] -= ux * force;
            dispY[a] -= uy * force;
            dispX[b] += ux * force;
            dispY[b] += uy * force;
        }

        // Apply displacements, clamped by temperature. No box clamp: FR in a
        // bounded plane without gravity degenerates (everything flees to the
        // boundary). Instead we let the layout run in unbounded space and
        // rescale into [0,size] at the end.
        for (let i = 0; i < N; i++) {
            const dx = dispX[i];
            const dy = dispY[i];
            const mag = Math.sqrt(dx * dx + dy * dy);
            if (mag > 0) {
                const capped = Math.min(mag, temperature);
                posX[i] += (dx / mag) * capped;
                posY[i] += (dy / mag) * capped;
            }
        }

        temperature -= cooling;
        if (temperature < 0.5) temperature = 0.5;
    }

    // Rescale the final layout into [0, size] × [0, size] preserving aspect
    // ratio. Uniform scale so the aspect ratio stays natural; the wider of
    // the two dimensions lands on the plane edge with a small margin.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < N; i++) {
        if (posX[i] < minX) minX = posX[i];
        if (posX[i] > maxX) maxX = posX[i];
        if (posY[i] < minY) minY = posY[i];
        if (posY[i] > maxY) maxY = posY[i];
    }
    const spanX = Math.max(maxX - minX, 1e-6);
    const spanY = Math.max(maxY - minY, 1e-6);
    const margin = size * 0.02;
    const usable = size - margin * 2;
    const scale = Math.min(usable / spanX, usable / spanY);
    const offsetX = margin + (usable - spanX * scale) / 2 - minX * scale;
    const offsetY = margin + (usable - spanY * scale) / 2 - minY * scale;

    const out: Position[] = new Array(N);
    for (let i = 0; i < N; i++) {
        out[i] = { x: posX[i] * scale + offsetX, y: posY[i] * scale + offsetY };
    }
    return out;
}

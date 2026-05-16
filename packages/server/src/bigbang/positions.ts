import { HEX_CELL_SIZE, HEX_SPACING_MULTIPLIER } from './types.js';

export interface Position {
    x: number;
    y: number;
}

/**
 * Hex cell axial coordinate. q = column, r = row in flat-top axial layout.
 * Used by graph-proximal.ts to compute hex adjacency without re-deriving from
 * cartesian positions.
 */
export interface HexCell {
    q: number;
    r: number;
}

export interface HexLayout {
    positions: Position[];
    cells: HexCell[];
}

const SQRT3 = Math.sqrt(3);

/**
 * Convert flat-top axial (q, r) to cartesian center coordinates. Spacing is
 * scaled by HEX_SPACING_MULTIPLIER so adjacent pills have visible warp
 * segments between them even with multi-digit sector labels.
 */
export function hexToCartesian(q: number, r: number): Position {
    return {
        x: HEX_CELL_SIZE * HEX_SPACING_MULTIPLIER * 1.5 * q,
        y: HEX_CELL_SIZE * HEX_SPACING_MULTIPLIER * SQRT3 * (r + q / 2),
    };
}

/** The six neighbor directions in axial coordinates (flat-top). */
export const HEX_NEIGHBOR_DIRS: ReadonlyArray<HexCell> = [
    { q: +1, r: 0 },
    { q: +1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: +1 },
    { q: 0, r: +1 },
];

/** Axial hex distance: `(|Δq| + |Δq+Δr| + |Δr|) / 2`. */
export function hexDistance(a: HexCell, b: HexCell): number {
    const dq = a.q - b.q;
    const dr = a.r - b.r;
    return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}

/**
 * Remap a hex layout so the given anchor sector IDs land on well-separated
 * cells. The first anchor goes to the most-central cell (closest to the
 * centroid); subsequent anchors are chosen by farthest-first traversal —
 * each one maximises the minimum hex distance to already-chosen anchors.
 *
 * The cells/positions arrays are reindexed so `cells[i-1]` is the cell for
 * sector `i`, with anchor IDs displaced into their chosen cells and the
 * sectors they displaced filling the vacancies.
 */
export function arrangeAnchors(
    layout: HexLayout,
    anchorSectorIds: readonly number[],
): HexLayout {
    const N = layout.cells.length;
    if (N === 0 || anchorSectorIds.length === 0) return layout;

    // Pick anchor cell indices: centroid-closest, then farthest-first.
    const centroidQ = layout.cells.reduce((s, c) => s + c.q, 0) / N;
    const centroidR = layout.cells.reduce((s, c) => s + c.r, 0) / N;
    const centroidCell: HexCell = { q: centroidQ, r: centroidR };
    let centralIdx = 0;
    let bestCentralDist = Infinity;
    for (let i = 0; i < N; i++) {
        const d = hexDistance(layout.cells[i], centroidCell);
        if (d < bestCentralDist) {
            bestCentralDist = d;
            centralIdx = i;
        }
    }
    const anchorCellIndices: number[] = [centralIdx];
    const chosen = new Uint8Array(N);
    chosen[centralIdx] = 1;
    while (anchorCellIndices.length < anchorSectorIds.length && anchorCellIndices.length < N) {
        let bestIdx = -1;
        let bestMinDist = -1;
        for (let i = 0; i < N; i++) {
            if (chosen[i]) continue;
            let minD = Infinity;
            for (const aIdx of anchorCellIndices) {
                const d = hexDistance(layout.cells[i], layout.cells[aIdx]);
                if (d < minD) minD = d;
            }
            if (minD > bestMinDist) {
                bestMinDist = minD;
                bestIdx = i;
            }
        }
        if (bestIdx < 0) break;
        anchorCellIndices.push(bestIdx);
        chosen[bestIdx] = 1;
    }

    // Build new cell ordering: sector ID `s` reads from cellIdxForSector[s].
    const cellIdxForSector = new Int32Array(N + 1).fill(-1);
    for (let i = 0; i < anchorCellIndices.length; i++) {
        cellIdxForSector[anchorSectorIds[i]] = anchorCellIndices[i];
    }
    const usedCellIndices = new Set(anchorCellIndices);
    let nextFree = 0;
    for (let s = 1; s <= N; s++) {
        if (cellIdxForSector[s] !== -1) continue;
        while (usedCellIndices.has(nextFree)) nextFree++;
        cellIdxForSector[s] = nextFree;
        nextFree++;
    }

    const newCells: HexCell[] = new Array(N);
    const newPositions: Position[] = new Array(N);
    for (let s = 1; s <= N; s++) {
        const src = cellIdxForSector[s];
        newCells[s - 1] = layout.cells[src];
        newPositions[s - 1] = layout.positions[src];
    }
    return { cells: newCells, positions: newPositions };
}

/**
 * Sample N occupied hex cells from a square-ish bounded region whose total
 * cell count is approximately N / fillDensity. Returns both the cartesian
 * centers (for sectors) and the axial coords (so the warp generator can find
 * neighbors with O(1) hash lookups).
 *
 * Distribution within the region is uniform: every cell is equally likely.
 * Lower fillDensity → bigger empty patches and more peripheral gaps.
 */
export function scatterPositions(
    N: number,
    rng: () => number,
    fillDensity: number,
): HexLayout {
    if (N < 1) return { positions: [], cells: [] };
    const density = Math.min(0.999, Math.max(0.05, fillDensity));
    const totalCells = Math.max(N, Math.ceil(N / density));
    // Square-ish grid: side ≈ √totalCells. Slight rounding-up so we have a
    // few extra cells to sample from (helps uniformity at small N).
    const side = Math.max(1, Math.ceil(Math.sqrt(totalCells)));
    const allCells: HexCell[] = [];
    for (let q = 0; q < side; q++) {
        for (let r = 0; r < side; r++) {
            allCells.push({ q, r });
        }
    }
    // Fisher–Yates partial shuffle: pick the first N cells from a permutation.
    for (let i = allCells.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [allCells[i], allCells[j]] = [allCells[j], allCells[i]];
    }
    const cells = allCells.slice(0, N);
    const positions = cells.map((c) => hexToCartesian(c.q, c.r));
    return { positions, cells };
}

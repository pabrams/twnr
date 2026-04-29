import { HEX_CELL_SIZE, DEFAULT_FILL_DENSITY } from './types.js';

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

/** Convert flat-top axial (q, r) to cartesian center coordinates. */
export function hexToCartesian(q: number, r: number): Position {
    return {
        x: HEX_CELL_SIZE * 1.5 * q,
        y: HEX_CELL_SIZE * SQRT3 * (r + q / 2),
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
    fillDensity: number = DEFAULT_FILL_DENSITY,
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

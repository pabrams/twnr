import { HEX_CELL_SIZE, HEX_SPACING_MULTIPLIER } from '@twnr/shared';

export { HEX_CELL_SIZE, HEX_SPACING_MULTIPLIER };

export type Topology = 'random' | 'proximal';

/**
 * Universe "shape" knob — controls how far apart the periphery sectors are.
 * Smaller values = tighter universe (more wormholes swapped in); larger
 * values = sprawling universe (few or no wormholes). The actual diameter
 * cap is interpolated from `maxShortestPathTable` per N.
 */
export type MaxShortestPath = 'packed' | 'narrow' | 'medium' | 'wide' | 'vast';

/**
 * Hand-tuned diameter targets per profile per universe size. The runtime
 * cap is linearly interpolated in log(N) between bracketing rows; lerp
 * clamps to the table bounds outside [100, 30000].
 */
export const maxShortestPathTable: Record<MaxShortestPath, ReadonlyArray<[number, number]>> = {
    packed: [[100, 10], [500, 12], [1000, 15], [5000, 20], [10000, 30], [20000, 40], [30000, 45]],
    narrow: [[100, 12], [500, 15], [1000, 20], [5000, 25], [10000, 35], [20000, 45], [30000, 50]],
    medium: [[100, 15], [500, 20], [1000, 25], [5000, 30], [10000, 40], [20000, 50], [30000, 60]],
    wide: [[100, 18], [500, 25], [1000, 30], [5000, 35], [10000, 45], [20000, 55], [30000, 70]],
    vast: [[100, 20], [500, 30], [1000, 35], [5000, 40], [10000, 50], [20000, 60], [30000, 80]],
};

/** Compute the diameter cap for a given profile and universe size. */
export function maxShortestPathFor(profile: MaxShortestPath, N: number): number {
    const rows = maxShortestPathTable[profile];
    if (N <= rows[0][0]) return rows[0][1];
    if (N >= rows[rows.length - 1][0]) return rows[rows.length - 1][1];
    const logN = Math.log(N);
    for (let i = 1; i < rows.length; i++) {
        const [hiN, hiCap] = rows[i];
        if (N <= hiN) {
            const [loN, loCap] = rows[i - 1];
            const t = (logN - Math.log(loN)) / (Math.log(hiN) - Math.log(loN));
            return Math.round(loCap + t * (hiCap - loCap));
        }
    }
    return rows[rows.length - 1][1];
}

export interface BigBangOptions {
    sectors: number;
    seed: number;
    portDensity: number;
    planetDensity: number;
    twoWayPct: number;
    /** Cumulative degree distribution, degree-0 prepended so warpDist[degree] indexes directly. */
    warpDist: number[];
    topology: Topology;
    /** Number of class-0 ports beyond the mandatory one at sector 1. Each gets a forced 6-out target and a far-apart hex placement. */
    additionalClassZeroPorts: number;
    /** "Shape" of the universe (proximal only) — names a row of `maxShortestPathTable`. Controls how aggressively wormholes are swapped in to cap diameter. */
    maxShortestPath: MaxShortestPath;
}

export interface GeneratedSector {
    id: number;
    name: string;
    x: number | null;
    y: number | null;
}

export interface GeneratedWarp {
    from: number;
    to: number;
}

export interface GeneratedPort {
    sector: number;
    class: number;
    fuel_qty: number;
    fuel_max: number;
    fuel_prod: number;
    fuel_mcic: number;
    org_qty: number;
    org_max: number;
    org_prod: number;
    org_mcic: number;
    equ_qty: number;
    equ_max: number;
    equ_prod: number;
    equ_mcic: number;
}

export interface GeneratedPlanet {
    sector: number;
    name: string;
    type: string;
}

export interface BigBangResult {
    seed: number;
    topology: Topology;
    sectors: GeneratedSector[];
    warps: GeneratedWarp[];
    ports: GeneratedPort[];
    planets: GeneratedPlanet[];
    /** Sector IDs that should be persisted as class-0 ports beyond the mandatory sector-1 hub. */
    extraClassZeroSectorIds: number[];
}

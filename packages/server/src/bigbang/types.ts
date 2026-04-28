import {
    DEFAULT_WARP_DIST_1_6,
    DEFAULT_TWO_WAY_PCT,
    DEFAULT_PORT_DENSITY,
    DEFAULT_TOPOLOGY,
} from '@twnr/shared';

/** Default warp-out degree distribution for degrees 1-6 (index 0 unused). */
export const DEFAULT_WARP_DIST: number[] = [0, ...DEFAULT_WARP_DIST_1_6];

// Re-export the shared generation defaults so server-internal callers don't
// have to reach into @twnr/shared themselves.
export { DEFAULT_TWO_WAY_PCT, DEFAULT_PORT_DENSITY, DEFAULT_TOPOLOGY };

export type Topology = 'random' | 'proximal';

/** Side length of the bounded plane used by proximal topology. */
export const PROXIMAL_PLANE_SIZE = 10000;

export interface BigBangOptions {
    sectors: number;
    seed?: number;
    portDensity?: number; // 1-100
    twoWayPct?: number; // 0-100
    warpDist?: number[]; // 6-element array for degrees 1-6, default DEFAULT_WARP_DIST
    topology?: Topology; // default 'random'
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
    fuel_price: number;
    org_qty: number;
    org_max: number;
    org_price: number;
    equ_qty: number;
    equ_max: number;
    equ_price: number;
}

export interface BigBangResult {
    seed: number;
    topology: Topology;
    sectors: GeneratedSector[];
    warps: GeneratedWarp[];
    ports: GeneratedPort[];
}

import { HEX_CELL_SIZE, HEX_SPACING_MULTIPLIER } from '@twnr/shared';

export { HEX_CELL_SIZE, HEX_SPACING_MULTIPLIER };

export type Topology = 'random' | 'proximal';

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

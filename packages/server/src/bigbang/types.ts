import {
    DEFAULT_WARP_DIST_1_6,
    DEFAULT_TWO_WAY_PCT,
    DEFAULT_PORT_DENSITY,
    DEFAULT_TOPOLOGY,
    DEFAULT_FILL_DENSITY,
    DEFAULT_MAX_PATH_LENGTH,
    HEX_CELL_SIZE,
} from '@twnr/shared';

export const DEFAULT_WARP_DIST: number[] = [0, ...DEFAULT_WARP_DIST_1_6];

export {
    DEFAULT_TWO_WAY_PCT,
    DEFAULT_PORT_DENSITY,
    DEFAULT_TOPOLOGY,
    DEFAULT_FILL_DENSITY,
    DEFAULT_MAX_PATH_LENGTH,
    HEX_CELL_SIZE,
};

export type Topology = 'random' | 'proximal';

export interface BigBangOptions {
    sectors: number;
    seed?: number;
    portDensity?: number;
    planetDensity?: number;
    twoWayPct?: number;
    warpDist?: number[];
    topology?: Topology;
    /** Hex layout: fraction of cells in the bounding rectangle that are occupied (0.1–1.0). */
    fillDensity?: number;
    /** Hex layout: diameter cap; wormholes are added until BFS eccentricity drops below this. */
    maxPathLength?: number;
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
}

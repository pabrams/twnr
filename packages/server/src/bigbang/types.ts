import { universeConfig, HEX_CELL_SIZE, HEX_SPACING_MULTIPLIER } from '@twnr/shared';

// degree-0 prepended so DEFAULT_WARP_DIST[degree] indexes by degree directly
export const DEFAULT_WARP_DIST: number[] = [0, ...universeConfig.warpDist];

export const DEFAULT_TWO_WAY_PCT = universeConfig.twoWayPct;
export const DEFAULT_PORT_DENSITY = universeConfig.portSpawnDensity;
export const DEFAULT_TOPOLOGY = universeConfig.topology;
export const DEFAULT_FILL_DENSITY = universeConfig.fillDensity;
export const DEFAULT_MAX_PATH_LENGTH = universeConfig.maxPathLength;

export { HEX_CELL_SIZE, HEX_SPACING_MULTIPLIER };

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

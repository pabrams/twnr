import {
    DEFAULT_WARP_DIST_1_6,
    DEFAULT_TWO_WAY_PCT,
    DEFAULT_PORT_DENSITY,
    DEFAULT_TOPOLOGY,
} from '@twnr/shared';

export const DEFAULT_WARP_DIST: number[] = [0, ...DEFAULT_WARP_DIST_1_6];

export { DEFAULT_TWO_WAY_PCT, DEFAULT_PORT_DENSITY, DEFAULT_TOPOLOGY };

export type Topology = 'random' | 'proximal';

export const PROXIMAL_PLANE_SIZE = 10000;

export interface BigBangOptions {
    sectors: number;
    seed?: number;
    portDensity?: number;
    planetDensity?: number;
    twoWayPct?: number;
    warpDist?: number[];
    topology?: Topology;
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

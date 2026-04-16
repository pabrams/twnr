/** Default warp-out degree distribution for degrees 1-7 (index 0 unused). */
export const DEFAULT_WARP_DIST = [0, 12, 18, 20, 20, 15, 10, 5];

export interface BigBangOptions {
    sectors: number;
    seed?: number;
    portDensity?: number; // 1-100, default 80
    twoWayPct?: number; // 0-100, default 95
    warpDist?: number[]; // 7-element array for degrees 1-7, default DEFAULT_WARP_DIST
}

export interface GeneratedSector {
    id: number;
    name: string;
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
    sectors: GeneratedSector[];
    warps: GeneratedWarp[];
    ports: GeneratedPort[];
}

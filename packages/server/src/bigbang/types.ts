export interface BigBangOptions {
    sectors: number;
    seed?: number;
    portDensity?: number; // 1-100, default 50
    twoWayPct?: number; // 0-100, default 90
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
    fuel_price: number;
    org_qty: number;
    org_price: number;
    equ_qty: number;
    equ_price: number;
}

export interface BigBangResult {
    seed: number;
    sectors: GeneratedSector[];
    warps: GeneratedWarp[];
    ports: GeneratedPort[];
}

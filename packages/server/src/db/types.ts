import type { QueryResult } from 'pg';

/** Minimal interface satisfied by both Pool and PoolClient. */
export type Queryable = {
    query: <T extends object = Record<string, unknown>>(
        text: string,
        params?: unknown[],
    ) => Promise<QueryResult<T>>;
};

export interface HardwareRow {
    name: string;
    quantity: number;
}

export interface HardwareMaxRow {
    name: string;
    max_quantity: number;
}

export interface SectorNumberRow {
    sector_number: number;
}

export interface WarpRow {
    sector_number: number;
    visited: boolean;
}

export interface SectorShipRow {
    id: number;
    type_name: string;
    owner_name: string;
}

export interface CollisionRow {
    planet_name: string;
    colliding_with_name: string;
    collision_at: string;
}

export interface PortRow {
    sector_id: number;
    class: number;
    fuel: number;
    fuel_max: number;
    fuel_mcic: number;
    organics: number;
    org_max: number;
    org_mcic: number;
    equipment: number;
    equ_max: number;
    equ_mcic: number;
}

export interface HardwarePriceRow {
    name: string;
    label: string;
    price: number;
}

export interface DeployedDroneRow {
    sector_id: number;
    quantity: number;
    owner_player_id: number | null;
    owner_clan_id: number | null;
    owner_player_name: string | null;
    owner_clan_name: string | null;
    owner_clan_number: number | null;
}

export interface PlayerListRow {
    name: string;
    ship_name: string;
}

export interface PlayerPlanetRow {
    id: number;
    sector_number: number;
    name: string;
    type: string;
    display_type: string | null;
    drones: number;
    fuel: number;
    organics: number;
    equipment: number;
    colonists_fuel: number;
    colonists_organics: number;
    colonists_equipment: number;
    colonists_drones: number;
}


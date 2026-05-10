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
    fuel_price: number;
    organics: number;
    org_price: number;
    equipment: number;
    equ_price: number;
}

export interface HardwarePriceRow {
    name: string;
    label: string;
    price: number;
}

export interface DeployedDroneRow {
    sector_id: number;
    quantity: number;
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
    fuel: number;
    organics: number;
    equipment: number;
    colonists_fuel: number;
    colonists_organics: number;
    colonists_equipment: number;
}

export interface ShipTypeRow {
    id: number;
    name: string;
    display_name: string | null;
    make: string | null;
    sort_order: number;
    max_drones: number;
    max_shields: number;
    starting_holds: number;
    max_holds: number;
    odds_offensive: number;
    odds_defensive: number;
    has_pod: boolean;
    can_land: boolean;
    has_interdictor: boolean;
    has_planetary_defense_bonus: boolean;
    planetary_defense_odds: number | null;
    speed: number;
    turns_per_warp: number;
    cost_drive: number;
    cost_computer: number;
    cost_hull: number;
    hold_cost: number;
    max_drone_attack: number;
    transporter_range: number;
    has_tractor: boolean;
    piloting_restriction: string | null;
    notes: string | null;
    basic_hold_cost: number;
    base_cost: number;
}

export interface ShipTypeHardwareJoinRow {
    ship_type_id: number;
    name: string;
    max_quantity: number;
}

// Shared types used across packages. Anything imported by a runtime parser
// (config-file loaders, HTTP response handlers) has a paired zod schema so
// the parse site can be schema-driven; pure compile-time helpers stay as
// plain type aliases.

import { z } from 'zod';

// hex-grid spatial constants: server bakes them into sector coords at
// generation, client uses them to interpret those coords when rendering
export const HEX_CELL_SIZE = 100;
export const HEX_SPACING_MULTIPLIER = 1.4;

export const ShipConfigSchema = z.object({
    slug: z.string(),
    displayName: z.string().optional(),
    sortOrder: z.number(),
    speed: z.number(),
    startingHolds: z.number(),
    maxHolds: z.number(),
    maxShields: z.number(),
    maxDrones: z.number(),
    oddsOffensive: z.number(),
    oddsDefensive: z.number(),
    maxDroneAttack: z.number(),
    turnsPerWarp: z.number(),
    costDrive: z.number(),
    costComputer: z.number(),
    costHull: z.number(),
    holdCost: z.number(),
    maxBuoy: z.number(),
    maxProximity: z.number(),
    maxSeeker: z.number(),
    maxTerraformDevices: z.number(),
    maxPlanetBusters: z.number(),
    maxCloaking: z.number(),
    maxCorbomite: z.number(),
    maxPhoton: z.number(),
    maxDisruptors: z.number(),
    maxReconDrones: z.number(),
    transporterRange: z.number(),
    hasPod: z.boolean(),
    canLand: z.boolean(),
    hasInterdictor: z.boolean(),
    hasTractor: z.boolean(),
    canHaveHyperspace1: z.boolean(),
    canHaveHyperspace2: z.boolean(),
    canHaveVisualScanner: z.boolean(),
    canHavePlanetScanner: z.boolean(),
    make: z.string().optional(),
    hasPlanetaryDefenseBonus: z.boolean().optional(),
    planetaryDefenseOdds: z.number().optional(),
    pilotingRestriction: z.string().optional(),
    notes: z.string().optional(),
});
export type ShipConfig = z.infer<typeof ShipConfigSchema>;

/** Per-level requirements to construct or upgrade a planetary defense bastion
 *  (PDB, aka "base", aka legacy "citadel"). Six levels, fuel/org/equ are
 *  one-time stock drains, colos is matched against planet colonist totals,
 *  days is real-time days the construction takes. */
export const BaseLevelRequirementSchema = z.object({
    fuel: z.number(),
    org: z.number(),
    equ: z.number(),
    colos: z.number(),
    days: z.number(),
});
export type BaseLevelRequirement = z.infer<typeof BaseLevelRequirementSchema>;

export const PlanetConfigSchema = z.object({
    slug: z.string(),
    displayName: z.string().optional(),
    description: z.string(),
    class: z.string(),
    baseRequirements: z.array(BaseLevelRequirementSchema),
    danger: z.number(),
    maxFuelColos: z.number(),
    maxOrgColos: z.number(),
    maxEquColos: z.number(),
    maxFuel: z.number(),
    maxOrg: z.number(),
    maxEqu: z.number(),
    maxDrones: z.number(),
    maxCitadel: z.number(),
    fuelProduction: z.number(),
    organicsProduction: z.number(),
    equipmentProduction: z.number(),
    figFactorFuel: z.number(),
    figFactorOrg: z.number(),
    figFactorEqu: z.number(),
});
export type PlanetConfig = z.infer<typeof PlanetConfigSchema>;

export type ShipCatalogEntry = {
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
    hardware: Record<string, number>;
};

export const AuthTokenPayloadSchema = z.object({
    userId: z.number(),
    name: z.string().optional(),
    role: z.string().optional(),
    tokenVersion: z.number(),
});
export type AuthTokenPayload = z.infer<typeof AuthTokenPayloadSchema>;

export const AuthResponseSchema = z.object({
    userId: z.number(),
    name: z.string().optional(),
    role: z.string(),
    token: z.string(),
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

export const LogoutResponseSchema = z.object({
    success: z.boolean(),
});
export type LogoutResponse = z.infer<typeof LogoutResponseSchema>;

export const ServerStatsResponseSchema = z.object({
    uptime: z.number(),
    playersOnline: z.number(),
    totalPlayers: z.number(),
    totalSectors: z.number(),
    nodeVersion: z.string(),
    platform: z.string(),
});
export type ServerStatsResponse = z.infer<typeof ServerStatsResponseSchema>;

export type MenuCommandEntry = {
    command: string;
    keyPattern: string;
    label: string;
    targetMenu: string | null;
    sortOrder: number;
};

export type MenuEntry = {
    name: string;
    label: string;
    parentMenu: string | null;
    commands: MenuCommandEntry[];
};

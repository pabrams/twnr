// Anything parsed at runtime (config loaders, HTTP responses) gets a paired
// zod schema; pure compile-time helpers stay plain type aliases.

import { z } from 'zod';

// Baked into stored sector coords at generation — changing them breaks
// existing universes' coordinates.
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

/** One base ("citadel") level: fuel/org/equ are one-time stock drains, colos
 *  is checked against planet colonist totals, days is real-time days. */
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

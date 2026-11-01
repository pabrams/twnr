// Read-only universe reference data.

import { z } from 'zod';

import { defineCommand, outcomes } from './define.js';

import { Int, Num, Bool, Str, NumOrNull, IntOrNull, StrOrNull, HardwareMap } from './common.js';

/** `name` is the ship-type slug BuyShipNew / BuyShipTradein take as `targetShipName`. */
export const ShipCatalogEntrySchema = z.object({
    name: Str,
    displayName: StrOrNull,
    make: StrOrNull,
    maxDrones: Num,
    maxShields: Num,
    startingHolds: Num,
    maxHolds: Num,
    oddsOffensive: Num,
    oddsDefensive: Num,
    maxDroneAttack: Num,
    speed: Num,
    turnsPerWarp: Num,
    transporterRange: Num,
    costDrive: Num,
    costComputer: Num,
    costHull: Num,
    holdCost: Num,
    /** Also the trade-in credit. */
    baseCost: Num,
    hasPod: Bool,
    canLand: Bool,
    hasInterdictor: Bool,
    hasTractor: Bool,
    hasPlanetaryDefenseBonus: Bool,
    planetaryDefenseOdds: NumOrNull,
    pilotingRestriction: StrOrNull,
    notes: StrOrNull,
    /** Values are max installable per item (toggles 0/1), not installed counts. */
    hardware: HardwareMap,
});

export type ShipCatalogEntry = z.infer<typeof ShipCatalogEntrySchema>;

export const PlanetCatalogEntrySchema = z.object({
    slug: Str,
    displayName: StrOrNull,
    description: StrOrNull,
    class: Str,
    danger: Num,
    maxFuelColos: Num,
    maxOrgColos: Num,
    maxEquColos: Num,
    maxFuel: Num,
    maxOrg: Num,
    maxEqu: Num,
    maxDrones: Num,
    maxCitadel: Num,
    fuelProduction: Num,
    organicsProduction: Num,
    equipmentProduction: Num,
    figFactorFuel: Num,
    figFactorOrg: Num,
    figFactorEqu: Num,
});

export type PlanetCatalogEntry = z.infer<typeof PlanetCatalogEntrySchema>;

/** `name` keys the `hardware` maps in ShipInfo/ShipDetail/ShipCatalog replies. */
export const HardwareCatalogItemSchema = z.object({
    name: Str,
    label: Str,
    kind: z.enum(['stackable', 'toggle']),
});

export type HardwareCatalogItem = z.infer<typeof HardwareCatalogItemSchema>;

/** Every player in the universe, online or not; `shipTypeName` null while the ship is destroyed. */
export const TraderListEntrySchema = z.object({
    name: Str,
    shipTypeName: StrOrNull,
    coloredShipName: StrOrNull,
    clanNumber: IntOrNull,
    clanName: StrOrNull,
    reputation: Num,
    experience: Num,
});

export type TraderListEntry = z.infer<typeof TraderListEntrySchema>;

export const PlayersOnline = defineCommand('playersOnline', {
    request: {},
    reply: outcomes({
        ok: {
            players: z.array(z.object({ id: Int, name: Str })),
        },
    }),
});

export const StarbaseInfo = defineCommand('starbaseInfo', {
    request: {},
    reply: outcomes({
        ok: {
            sector: IntOrNull,
            universeName: Str,
            sectorCount: Int,
            portCount: Int,
            createdAt: Str,
            daysElapsed: Num,
            outWarpDistribution: z.array(Num),
            maxPlanetsPerSector: Int,
            startingCredits: Num,
            startingTurns: Num,
            startingDrones: Num,
            startingHolds: Num,
            respawnDelaySeconds: Num,
        },
    }),
});

export const TraderList = defineCommand('traderList', {
    request: {},
    reply: outcomes({
        ok: {
            traders: z.array(TraderListEntrySchema),
        },
    }),
});

export const ShipCatalog = defineCommand('shipCatalog', {
    request: {},
    reply: outcomes({
        ok: {
            ships: z.array(ShipCatalogEntrySchema),
        },
    }),
});

export const PlanetCatalog = defineCommand('planetCatalog', {
    request: {},
    reply: outcomes({
        ok: {
            planets: z.array(PlanetCatalogEntrySchema),
        },
    }),
});

export const HardwareCatalog = defineCommand('hardwareCatalog', {
    request: {},
    reply: outcomes({
        ok: {
            items: z.array(HardwareCatalogItemSchema),
        },
    }),
});

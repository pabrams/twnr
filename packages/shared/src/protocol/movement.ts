// Moving between sectors and looking at them.

import { z } from 'zod';

import { defineCommand, defineEvent, defineReply, outcomes } from './define.js';

import {
    Int,
    Num,
    Bool,
    Str,
    NumOrNull,
    IntOrNull,
    StrOrNull,
    SectorRefSchema,
    SectorDisplayDataSchema,
    SectorNumber,
} from './common.js';

export const TowedAlongSchema = z.object({
    kind: z.enum(['manned', 'unmanned']),
    name: Str,
    shipTypeDisplayName: StrOrNull,
    shipTypeName: Str,
});

export type TowedAlong = z.infer<typeof TowedAlongSchema>;

export const DensityScanEntrySchema = z.object({
    sector: Int,
    visited: Bool,
    density: Num,
    warps: Num,
    navHaz: Num,
    anom: Bool,
});

export type DensityScanEntry = z.infer<typeof DensityScanEntrySchema>;

export const NeighborhoodSectorSchema = z.object({
    id: Int,
    sector_number: Int,
    x: NumOrNull,
    y: NumOrNull,
    visibility: z.enum(['visited', 'glimpsed']),
    fringe: Bool,
    port: z.object({ class: Int, observed_at: Str }).nullable(),
    planets: z.array(z.object({ name: Str, type: StrOrNull, observed_at: Str })),
    /** Player-perspective snapshot; all false when the player has never observed the sector. */
    observations: z
        .object({
            friendlyDrones: Bool,
            enemyDrones: Bool,
            friendlyProxMines: Bool,
            enemyProxMines: Bool,
            friendlySeekerMines: Bool,
        })
        .optional(),
});

export type NeighborhoodSector = z.infer<typeof NeighborhoodSectorSchema>;

export const NeighborhoodWarpSchema = z.object({
    from_sector_id: Int,
    to_sector_id: Int,
    known_two_way: Bool,
});

export type NeighborhoodWarp = z.infer<typeof NeighborhoodWarpSchema>;

export const PlayerMoved = defineEvent('playerMoved', {
    playerId: Int,
    playerName: Str,
    sector: Int,
    direction: z.enum(['in', 'out']),
    towedAlong: TowedAlongSchema.optional(),
});

export const SectorActivity = defineEvent('sectorActivity', {
    playerId: Int,
    playerName: Str,
    activity: z.enum(['land', 'liftoff', 'dock', 'undock']),
    targetName: Str.nullable(),
    shipName: Str.nullable(),
});

export const PlayerLeft = defineEvent('playerLeft', {
    playerId: Int,
});

export const ProximityMineHit = defineEvent('proximityMineHit', {
    sector: Int,
    detonations: Num,
    damage: Num,
    shieldsLost: Num,
    dronesLost: Num,
    destroyed: Bool,
});

export const SeekerMineAttached = defineEvent('seekerMineAttached', {
    sector: Int,
    droppedPrevious: Bool,
});

export const SeekerMinePickupAlert = defineEvent('seekerMinePickupAlert', {
    sector: Int,
    targetShipName: Str,
    targetOwnerName: Str,
});

export const Move = defineCommand('move', {
    request: {
        sector: SectorNumber,
    },
    reply: outcomes({
        success: SectorDisplayDataSchema.extend({
            turnsUsed: Num.optional(),
            towedAlong: TowedAlongSchema.optional(),
            freedFromTow: z.literal(true).optional(),
        }),
        encounter: SectorDisplayDataSchema.extend({
            ownerId: IntOrNull,
            ownerName: Str,
            shipDrones: Num,
            retreatSector: Int,
            turnsUsed: Num.optional(),
            towedAlong: TowedAlongSchema.optional(),
            freedFromTow: z.literal(true).optional(),
        }),
        nonAdjacent: {
            sector: Int,
        },
        noShip: {},
        destroyed: {
            reason: Str,
        },
    }),
});

// Reply tag predates the `${command}Result` convention (see protocol step 4).
const PreviousSectorResult = defineReply('previousSectorResult', {
    sector: IntOrNull,
});

export const MoveToPrevious = defineCommand('moveToPrevious', {
    request: {},
    reply: PreviousSectorResult,
});

export const SectorDisplay = defineCommand('sectorDisplay', {
    request: {},
    reply: SectorDisplayDataSchema,
});

export const WarpsOut = defineCommand('warpsOut', {
    request: {
        id: SectorNumber,
    },
    reply: {
        id: Int,
        warps: z.array(SectorRefSchema),
    },
});

export const ShortestPath = defineCommand('shortestPath', {
    request: {
        from: SectorNumber,
        to: SectorNumber,
    },
    reply: {
        path: z.array(SectorRefSchema),
        hops: Int,
        turns: Num,
    },
});

export const HyperspaceJump = defineCommand('hyperspaceJump', {
    request: {
        targetSector: SectorNumber,
    },
    reply: outcomes({
        ok: {
            targetSector: Int,
            fuelUsed: Num,
            turnsUsed: Num,
        },
        destroyed: { reason: Str },
    }),
});

// Reply tag predates the `${command}Result` convention (see protocol step 4).
const NeighborhoodResult = defineReply('neighborhoodResult', {
    topology: z.enum(['random', 'proximal']),
    current_sector_id: Int,
    sectors: z.array(NeighborhoodSectorSchema),
    warps: z.array(NeighborhoodWarpSchema),
});

// Dimensions and center are floats in world units, not sector ints.
export const GetNeighborhood = defineCommand('getNeighborhood', {
    request: {
        halfWidthWorld: z.number(),
        halfHeightWorld: z.number(),
        centerXWorld: z.number().optional(),
        centerYWorld: z.number().optional(),
    },
    reply: NeighborhoodResult,
});

export const VisitedSectors = defineCommand('visitedSectors', {
    request: {},
    reply: {
        sectors: z.array(Int),
        totalSectors: Int,
    },
});

export const DensityScan = defineCommand('densityScan', {
    request: {},
    reply: {
        entries: z.array(DensityScanEntrySchema),
        hasVisualScanner: Bool,
    },
});

export const VisualScan = defineCommand('visualScan', {
    request: {},
    reply: {
        sectors: z.array(SectorDisplayDataSchema),
    },
});

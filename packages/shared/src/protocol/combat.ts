// Ship-to-ship combat, sector drones, mines and beacons.

import { z } from 'zod';

import { defineCommand, defineEvent } from './define.js';

import { Ownership, MineTypeSchema, Int, Num, Bool, Str, OwnershipInfoSchema } from './common.js';

export const DeployedMineEntrySchema = z.object({
    sectorNumber: Int,
    mineType: MineTypeSchema,
    quantity: Num,
    ownerLabel: Str,
    ownership: OwnershipInfoSchema,
});

export type DeployedMineEntry = z.infer<typeof DeployedMineEntrySchema>;

export const TrackedSeekerMineEntrySchema = z.object({
    targetShipId: Int,
    targetShipName: Str,
    targetOwnerName: Str,
    sectorNumber: Int,
    ownership: OwnershipInfoSchema,
});

export type TrackedSeekerMineEntry = z.infer<typeof TrackedSeekerMineEntrySchema>;

export const SectorDronesAlert = defineEvent('sectorDronesAlert', {
    event: z.enum(['intrusion', 'attacked', 'destroyed']),
    sector: Int,
    dronesLost: Num,
    dronesRemaining: Num,
    intruderName: Str,
});

export const NoShip = defineEvent('noShip', {});

export const GetAttackTargets = defineCommand('getAttackTargets', {
    request: {},
    reply: {
        players: z.array(z.object({ id: Int, name: Str })),
        beaconPresent: Bool,
    },
});

export const AttackShip = defineCommand('attackShip', {
    request: {
        targetPlayerId: Int,
        drones: Int,
    },
    reply: {
        destroyed: Bool,
        attackerDronesLost: Num,
        defenderShieldsLost: Num,
        defenderDronesLost: Num,
        message: Str.optional(),
        expDelta: Num.optional(),
        repDelta: Num.optional(),
    },
});

export const DeployDronesInfo = defineCommand('deployDronesInfo', {
    request: {},
    reply: {
        sectorDrones: Num,
        shipDrones: Num,
        shipMaxDrones: Num,
    },
});

export const DeployDrones = defineCommand('deployDrones', {
    request: {
        quantity: Int,
        ownership: Ownership.optional(),
    },
    reply: {
        sectorDrones: Num,
        shipDrones: Num,
    },
});

export const AttackSectorDrones = defineCommand('attackSectorDrones', {
    request: {
        drones: Int,
    },
    reply: {
        victory: Bool,
        dronesLost: Num,
        sectorDronesRemaining: Num,
        shipDrones: Num,
        expDelta: Num.optional(),
        repDelta: Num.optional(),
    },
});

export const RetreatFromDrones = defineCommand('retreatFromDrones', {
    request: {},
    reply: {
        sector: Int,
    },
});

export const ListDeployedDrones = defineCommand('listDeployedDrones', {
    request: {},
    reply: {
        drones: z.array(
            z.object({
                sectorId: Int,
                quantity: Num,
                ownerLabel: Str,
                ownership: OwnershipInfoSchema,
            }),
        ),
    },
});

export const DeployMineInfo = defineCommand('deployMineInfo', {
    request: {
        mineType: MineTypeSchema,
    },
    reply: {
        mineType: MineTypeSchema,
        sectorMines: Num,
        shipMines: Num,
        shipMaxMines: Num,
    },
});

export const DeployMine = defineCommand('deployMine', {
    request: {
        mineType: MineTypeSchema,
        quantity: Int,
        ownership: Ownership.optional(),
    },
    reply: {
        mineType: MineTypeSchema,
        sectorMines: Num,
        shipMines: Num,
    },
});

export const ListDeployedMines = defineCommand('listDeployedMines', {
    request: {},
    reply: {
        mines: z.array(DeployedMineEntrySchema),
    },
});

export const TrackSeekerMines = defineCommand('trackSeekerMines', {
    request: {},
    reply: {
        targets: z.array(TrackedSeekerMineEntrySchema),
    },
});

export const MineDisruptor = defineCommand('mineDisruptor', {
    request: {
        targetSector: Int,
    },
    reply: {
        targetSector: Int,
        minesDisrupted: Num,
        proximityMinesRemaining: Num,
    },
});

export const ReleaseBeacon = defineCommand('releaseBeacon', {
    request: {
        message: z.string(),
    },
    reply: {
        outcome: z.enum(['launched', 'collision', 'noBeacons']),
        sector: Int,
        beaconsRemaining: Num,
    },
});

export const AttackBeacon = defineCommand('attackBeacon', {
    request: {},
    reply: {
        destroyed: Bool,
        shipDrones: Num,
    },
});

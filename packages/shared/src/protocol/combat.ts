// Ship-to-ship combat, sector drones, mines and beacons.

import { z } from 'zod';

import { defineCommand, defineEvent, outcomes } from './define.js';

import {
    Ownership,
    MineTypeSchema,
    Int,
    Num,
    Bool,
    Str,
    OwnershipInfoSchema,
    SectorDisplayDataSchema,
    PositiveInt,
    Id,
    SectorNumber,
    TargetOrDefault,
    BeaconMessage,
} from './common.js';

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

export const SectorDronesReported = defineEvent('sectorDronesReported', {
    event: z.enum(['intrusion', 'attacked', 'destroyed']),
    sector: Int,
    dronesLost: Num,
    dronesRemaining: Num,
    intruderName: Str,
});

export const ShipAttacked = defineEvent('shipAttacked', {
    attackerName: Str,
    destroyed: Bool,
    attackerDronesLost: Num,
    defenderShieldsLost: Num,
    defenderDronesLost: Num,
    expDelta: Num.optional(),
    repDelta: Num.optional(),
});

export const AttackTargets = defineCommand('attackTargets', {
    request: {},
    reply: outcomes({
        ok: {
            players: z.array(z.object({ id: Int, name: Str })),
            beaconPresent: Bool,
        },
    }),
});

export const AttackShip = defineCommand('attackShip', {
    request: {
        targetPlayerId: Id,
        drones: PositiveInt,
    },
    reply: outcomes({
        ok: {
            destroyed: Bool,
            attackerDronesLost: Num,
            defenderShieldsLost: Num,
            defenderDronesLost: Num,
            expDelta: Num.optional(),
            repDelta: Num.optional(),
        },
    }),
});

export const DeployDronesInfo = defineCommand('deployDronesInfo', {
    request: {},
    reply: outcomes({
        ok: {
            sectorDrones: Num,
            shipDrones: Num,
            shipMaxDrones: Num,
        },
        noShip: {},
    }),
});

export const DeployDrones = defineCommand('deployDrones', {
    request: {
        quantity: TargetOrDefault,
        ownership: Ownership.optional(),
    },
    reply: outcomes({
        ok: {
            sectorDrones: Num,
            shipDrones: Num,
        },
        noShip: {},
    }),
});

export const AttackSectorDrones = defineCommand('attackSectorDrones', {
    request: {
        drones: PositiveInt,
    },
    reply: outcomes({
        ok: {
            victory: Bool,
            dronesLost: Num,
            sectorDronesRemaining: Num,
            shipDrones: Num,
            expDelta: Num.optional(),
            repDelta: Num.optional(),
        },
        noShip: {},
    }),
});

/** The sector the player retreated into, as a full sector display. */
export const RetreatFromDrones = defineCommand('retreatFromDrones', {
    request: {},
    reply: outcomes({
        ok: SectorDisplayDataSchema,
        destroyed: { reason: Str },
    }),
});

export const ListDeployedDrones = defineCommand('listDeployedDrones', {
    request: {},
    reply: outcomes({
        ok: {
            drones: z.array(
                z.object({
                    sectorId: Int,
                    quantity: Num,
                    ownerLabel: Str,
                    ownership: OwnershipInfoSchema,
                }),
            ),
        },
    }),
});

export const DeployMineInfo = defineCommand('deployMineInfo', {
    request: {
        mineType: MineTypeSchema,
    },
    reply: outcomes({
        ok: {
            mineType: MineTypeSchema,
            sectorMines: Num,
            shipMines: Num,
            shipMaxMines: Num,
        },
    }),
});

export const DeployMine = defineCommand('deployMine', {
    request: {
        mineType: MineTypeSchema,
        quantity: TargetOrDefault,
        ownership: Ownership.optional(),
    },
    reply: outcomes({
        ok: {
            mineType: MineTypeSchema,
            sectorMines: Num,
            shipMines: Num,
        },
    }),
});

export const ListDeployedMines = defineCommand('listDeployedMines', {
    request: {},
    reply: outcomes({
        ok: {
            mines: z.array(DeployedMineEntrySchema),
        },
    }),
});

export const TrackSeekerMines = defineCommand('trackSeekerMines', {
    request: {},
    reply: outcomes({
        ok: {
            targets: z.array(TrackedSeekerMineEntrySchema),
        },
    }),
});

export const MineDisruptor = defineCommand('mineDisruptor', {
    request: {
        targetSector: SectorNumber,
    },
    reply: outcomes({
        ok: {
            targetSector: Int,
            minesDisrupted: Num,
            proximityMinesRemaining: Num,
        },
    }),
});

export const ReleaseBeacon = defineCommand('releaseBeacon', {
    request: {
        message: BeaconMessage,
    },
    reply: outcomes({
        launched: { sector: Int, beaconsRemaining: Num },
        collision: { sector: Int, beaconsRemaining: Num },
    }),
});

export const AttackBeacon = defineCommand('attackBeacon', {
    request: {},
    reply: outcomes({
        ok: {
            destroyed: Bool,
            shipDrones: Num,
        },
    }),
});

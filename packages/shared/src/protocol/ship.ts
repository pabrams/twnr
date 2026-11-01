// The player's ship: info, upgrades, purchases, hardware, transport and towing.

import { z } from 'zod';

import { defineCommand, defineEvent, defineReply, outcomes } from './define.js';

import {
    Ownership,
    Int,
    Num,
    Bool,
    Str,
    NumOrNull,
    IntOrNull,
    StrOrNull,
    HardwareMap,
    OwnershipInfoSchema,
    PositiveInt,
    Id,
    ShipName,
} from './common.js';

export const HardwareStoreItemSchema = z.object({
    name: Str,
    label: Str,
    kind: z.enum(['stackable', 'toggle']),
    price: Num,
    currentQty: Num,
    maxQty: Num,
});

export type HardwareStoreItem = z.infer<typeof HardwareStoreItemSchema>;

export const TowableMannedEntrySchema = z.object({
    playerId: Int,
    playerName: Str,
    clanNumber: IntOrNull,
    shipId: Int,
    shipName: Str,
    shipTypeName: Str,
    shipTypeDisplayName: StrOrNull,
    drones: Num,
});

export type TowableMannedEntry = z.infer<typeof TowableMannedEntrySchema>;

export const TowableUnmannedEntrySchema = z.object({
    shipId: Int,
    shipName: Str,
    shipTypeName: Str,
    shipTypeDisplayName: StrOrNull,
    drones: Num,
    ownership: OwnershipInfoSchema,
});

export type TowableUnmannedEntry = z.infer<typeof TowableUnmannedEntrySchema>;

export const TowReleasedAlert = defineEvent('towReleasedAlert', {
    towedName: Str,
});

export const TowAttachedAlert = defineEvent('towAttachedAlert', {
    towingName: Str,
});

export const ShipInfo = defineCommand('shipInfo', {
    request: {},
    reply: {
        playerId: Int,
        shipTypeName: Str,
        coloredShipName: StrOrNull,
        drones: Num,
        shields: Num,
        maxDrones: Num,
        maxShields: Num,
        cargoLimit: Num,
        maxHolds: Num,
        cargoFuel: Num,
        cargoOrganics: Num,
        cargoEquipment: Num,
        cargoColonists: Num,
        holdsAvailable: Num,
        hardware: HardwareMap,
        hardwareMax: HardwareMap,
        turnsPerWarp: Num,
        hasHyperwarpDrive: Bool,
        turns: Num,
        credits: Num,
        clanNumber: IntOrNull,
        clanName: StrOrNull,
    },
});

export const BuyDrones = defineCommand('buyDrones', {
    request: {
        quantity: PositiveInt,
    },
    reply: {
        credits: Num,
        drones: Num,
    },
});

export const BuyShields = defineCommand('buyShields', {
    request: {
        quantity: PositiveInt,
    },
    reply: {
        credits: Num,
        shields: Num,
    },
});

export const BuyHolds = defineCommand('buyHolds', {
    request: {
        quantity: PositiveInt,
    },
    reply: {
        credits: Num,
        cargoLimit: Num,
        turnsUsed: Num.optional(),
    },
});

export const BuyShipNew = defineCommand('buyShipNew', {
    request: {
        targetShipName: z.string(),
        name: ShipName,
    },
    reply: {
        shipTypeName: Str,
        coloredShipName: StrOrNull,
        credits: Num,
        maxDrones: Num,
        maxShields: Num,
        cargoLimit: Num,
    },
});

export const BuyShipTradein = defineCommand('buyShipTradein', {
    request: {
        targetShipName: z.string(),
        name: ShipName,
    },
    reply: {
        shipTypeName: Str,
        coloredShipName: StrOrNull,
        credits: Num,
        maxDrones: Num,
        maxShields: Num,
        cargoLimit: Num,
    },
});

export const HardwareStoreInfo = defineCommand('hardwareStoreInfo', {
    request: {},
    reply: {
        credits: Num,
        items: z.array(HardwareStoreItemSchema),
    },
});

export const BuyHardware = defineCommand('buyHardware', {
    request: {
        itemName: z.string(),
        quantity: PositiveInt.optional(),
    },
    reply: {
        itemName: Str,
        label: Str,
        kind: z.enum(['stackable', 'toggle']),
        quantity: Num.optional(),
        totalOnShip: Num.optional(),
        credits: Num,
        cost: Num,
    },
});

export const ListOwnedShips = defineCommand('listOwnedShips', {
    request: {},
    reply: {
        currentSector: Int,
        currentShipId: IntOrNull,
        currentShipTypeName: StrOrNull,
        currentShipTypeDisplayName: StrOrNull,
        currentShipTransporterRange: NumOrNull,
        viewerClanId: IntOrNull,
        ships: z.array(
            z.object({
                id: Int,
                shipNumber: Int,
                sector: IntOrNull,
                drones: Num,
                shields: Num,
                holds: Num,
                hops: IntOrNull,
                typeName: Str,
                typeDisplayName: StrOrNull,
                transporterRange: Num,
                ownerPlayerId: IntOrNull,
                ownerClanId: IntOrNull,
                ownerLabel: Str,
            }),
        ),
    },
});

// Reply tag predates the `${command}Result` convention (see protocol step 4).
const ShipDetailResult = defineReply('shipDetailResult', {
    shipId: Int,
    shipNumber: Int,
    typeName: Str,
    typeDisplayName: StrOrNull,
    sector: IntOrNull,
    drones: Num,
    maxDrones: Num,
    shields: Num,
    maxShields: Num,
    holds: Num,
    maxHolds: Num,
    transporterRange: Num,
    cargoFuel: Num,
    cargoOrganics: Num,
    cargoEquipment: Num,
    cargoColonists: Num,
    ownership: OwnershipInfoSchema,
    hardware: HardwareMap,
    hardwareMax: HardwareMap,
});

export const GetShipDetail = defineCommand('getShipDetail', {
    request: {
        shipId: Id,
    },
    reply: ShipDetailResult,
});

export const TransportToShip = defineCommand('transportToShip', {
    request: {
        shipId: Id,
    },
    reply: {
        targetShipId: Int,
        targetSector: Int,
        turnsUsed: Num,
        turnsRemaining: Num,
    },
});

export const ChangeShipOwnership = defineCommand('changeShipOwnership', {
    request: {
        ownership: Ownership,
    },
    reply: {
        shipId: Int,
        ownership: Ownership,
    },
});

export const TowSpacecraft = defineCommand('towSpacecraft', {
    request: {},
    reply: outcomes({
        disengaged: {},
        none: {},
        options: {
            sector: Int,
            manned: z.array(TowableMannedEntrySchema),
            unmanned: z.array(TowableUnmannedEntrySchema),
        },
    }),
});

export const TowAttach = defineCommand('towAttach', {
    request: {
        shipId: Id,
    },
    reply: outcomes({
        ok: {
            targetName: Str,
            turnsPerWarp: Num,
        },
    }),
});

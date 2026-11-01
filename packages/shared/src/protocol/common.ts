import { z } from 'zod';

export const Commodity3 = z.enum(['fuel', 'organics', 'equipment']);

export const Ownership = z.enum(['personal', 'clan']);

export const MineTypeSchema = z.enum(['proximity', 'seeker']);

export const Int = z.number().int();

// Request-side constraints: anything the client can check before sending is
// enforced here, so handlers only refuse on game state.
export const PositiveInt = Int.min(1);
export const Id = PositiveInt;
export const SectorNumber = PositiveInt;
/** An amount to move: at least 1, or -1 for "all". */
export const QuantityOrAll = Int.refine((n) => n === -1 || n >= 1, {
    message: 'quantity must be at least 1, or -1 for all',
});
/** A deployment target: 0 or more (0 recalls everything), or -1 for the default. */
export const TargetOrDefault = Int.min(-1);

export const MAX_SHIP_NAME_LENGTH = 20;
export const MAX_PLANET_NAME_LENGTH = 64;
export const MAX_PORT_NAME_LENGTH = 39;
export const MAX_BEACON_MESSAGE_LENGTH = 41;
export const MAX_MEMO_LENGTH = 2000;
export const MAX_HAIL_LENGTH = 2000;
export const CLAN_NAME_LENGTH = { min: 2, max: 32 } as const;
export const CLAN_PASSWORD_LENGTH = { min: 4, max: 64 } as const;

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);
export const ShipName = trimmed(1, MAX_SHIP_NAME_LENGTH);
export const PlanetName = trimmed(1, MAX_PLANET_NAME_LENGTH);
export const PortName = trimmed(1, MAX_PORT_NAME_LENGTH);
export const BeaconMessage = trimmed(1, MAX_BEACON_MESSAGE_LENGTH);
export const MemoBody = trimmed(1, MAX_MEMO_LENGTH);
export const HailBody = trimmed(1, MAX_HAIL_LENGTH);
export const ClanName = trimmed(CLAN_NAME_LENGTH.min, CLAN_NAME_LENGTH.max);
export const ClanPassword = z.string().min(CLAN_PASSWORD_LENGTH.min).max(CLAN_PASSWORD_LENGTH.max);

export const Num = z.number();

export const Bool = z.boolean();

export const Str = z.string();

export const NumOrNull = Num.nullable();

export const IntOrNull = Int.nullable();

export const StrOrNull = Str.nullable();

export const HardwareMap = z.record(Str, Num);

export const DateString = z.string();

export const SectorRefSchema = z.object({
    sector: Int,
    visited: Bool,
});

export type SectorRef = z.infer<typeof SectorRefSchema>;

export const OwnershipInfoSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('player'),
        name: Str,
        playerId: Int,
        ownerClanNumber: IntOrNull,
    }),
    z.object({
        kind: z.literal('clan'),
        name: Str,
        clanNumber: Int,
        clanId: Int,
    }),
    z.object({ kind: z.literal('rogue') }),
]);

export type OwnershipInfo = z.infer<typeof OwnershipInfoSchema>;

export const SectorDroneInfoSchema = z.object({
    quantity: Num,
    ownerId: IntOrNull,
    ownership: OwnershipInfoSchema,
});

export type SectorDroneInfo = z.infer<typeof SectorDroneInfoSchema>;

export const CollisionInfoSchema = z.object({
    planetName: Str,
    collidingWithName: Str,
    collisionAt: Str,
});

export type CollisionInfo = z.infer<typeof CollisionInfoSchema>;

export const SectorMineEntrySchema = z.object({
    mineType: MineTypeSchema,
    quantity: Num,
    own: Bool,
    ownership: OwnershipInfoSchema,
});

export type SectorMineEntry = z.infer<typeof SectorMineEntrySchema>;

export const SectorBeaconInfoSchema = z.object({
    message: Str,
    ownership: OwnershipInfoSchema,
});

export type SectorBeaconInfo = z.infer<typeof SectorBeaconInfoSchema>;

export const SectorDisplayDataSchema = z.object({
    sector: Int,
    players: z.array(
        z.object({
            id: Int,
            name: Str,
            clanNumber: IntOrNull,
            shipName: Str,
            shipTypeName: Str,
            shipTypeDisplayName: StrOrNull,
            drones: Num,
        }),
    ),
    warps: z.array(SectorRefSchema),
    port: z.object({ class: Int, name: Str }).nullable().optional(),
    portConstruction: z.object({ class: Int, name: Str, daysLeft: Num }).nullable().optional(),
    sectorDrones: SectorDroneInfoSchema.nullable().optional(),
    planets: z.array(z.object({ id: Int, name: Str, type: Str, displayType: StrOrNull })),
    ships: z
        .array(
            z.object({
                id: Int,
                name: Str,
                typeName: Str,
                typeDisplayName: StrOrNull,
                drones: Num,
                ownership: OwnershipInfoSchema,
            }),
        )
        .optional(),
    collisions: z.array(CollisionInfoSchema).optional(),
    sectorMines: z.array(SectorMineEntrySchema).optional(),
    beacon: SectorBeaconInfoSchema.nullable().optional(),
});

export type SectorDisplayData = z.infer<typeof SectorDisplayDataSchema>;

export const MineType = z.enum(['proximity', 'seeker']);

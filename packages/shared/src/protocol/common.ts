import { z } from 'zod';

export const Commodity3 = z.enum(['fuel', 'organics', 'equipment']);

export const Ownership = z.enum(['personal', 'clan']);

export const MineTypeSchema = z.enum(['proximity', 'seeker']);

export const Int = z.number().int();

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

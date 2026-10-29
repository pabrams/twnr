import { z } from 'zod';

const Int = z.number().int();
const Str = z.string();
const StrOrNull = Str.nullable();

export const GameEventPlayerRefSchema = z.object({ playerId: Int, name: Str });
export type GameEventPlayerRef = z.infer<typeof GameEventPlayerRefSchema>;

export const GameEventClanRefSchema = z.object({ clanId: Int, clanNumber: Int, name: Str });
export type GameEventClanRef = z.infer<typeof GameEventClanRefSchema>;

export const GameEventPlanetRefSchema = z.object({ planetId: Int, name: Str });
export type GameEventPlanetRef = z.infer<typeof GameEventPlanetRefSchema>;

export const GameEventShipTypeRefSchema = z.object({ slug: Str, displayName: StrOrNull });
export type GameEventShipTypeRef = z.infer<typeof GameEventShipTypeRefSchema>;

const GameEventOwnedRefSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('player'), playerId: Int, name: Str }),
    z.object({ kind: z.literal('clan'), clanId: Int, clanNumber: Int, name: Str }),
]);
export type GameEventOwnedRef = z.infer<typeof GameEventOwnedRefSchema>;

export const GameEventOwnerRefSchema = z.discriminatedUnion('kind', [
    ...GameEventOwnedRefSchema.options,
    z.object({ kind: z.literal('rogue') }),
]);
export type GameEventOwnerRef = z.infer<typeof GameEventOwnerRefSchema>;

export const GameEventSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('player_ship_destroyed_by_ship_combat'),
        attacker: GameEventPlayerRefSchema,
        victim: GameEventPlayerRefSchema,
        destroyedShipType: GameEventShipTypeRefSchema,
        sectorNumber: Int,
    }),
    z.object({
        kind: z.literal('player_ship_destroyed_by_sector_defenses'),
        victim: GameEventPlayerRefSchema,
        destroyedShipType: GameEventShipTypeRefSchema,
        defenseType: z.enum(['drones', 'mines']),
        defenseOwner: GameEventOwnerRefSchema,
        sectorNumber: Int,
    }),
    z.object({
        kind: z.literal('planet_collision'),
        planet: GameEventPlanetRefSchema,
        collidingWith: GameEventPlanetRefSchema,
        sectorNumber: Int,
    }),
    z.object({
        kind: z.literal('planet_destroyed'),
        destroyer: GameEventPlayerRefSchema,
        planet: GameEventPlanetRefSchema,
        sectorNumber: Int,
    }),
    z.object({ kind: z.literal('player_joined_universe'), player: GameEventPlayerRefSchema }),
    z.object({
        kind: z.literal('player_issued_ship'),
        player: GameEventPlayerRefSchema,
        shipId: Int,
        shipType: GameEventShipTypeRefSchema,
    }),
    z.object({
        kind: z.literal('clan_created'),
        founder: GameEventPlayerRefSchema,
        clan: GameEventClanRefSchema,
    }),
    z.object({
        kind: z.literal('player_joined_clan'),
        player: GameEventPlayerRefSchema,
        clan: GameEventClanRefSchema,
    }),
    z.object({
        kind: z.literal('player_left_clan'),
        player: GameEventPlayerRefSchema,
        clan: GameEventClanRefSchema,
    }),
    z.object({
        kind: z.literal('player_kicked_from_clan'),
        player: GameEventPlayerRefSchema,
        kickedBy: GameEventPlayerRefSchema,
        clan: GameEventClanRefSchema,
    }),
    z.object({
        kind: z.literal('clan_disbanded'),
        clan: GameEventClanRefSchema,
        lastMember: GameEventPlayerRefSchema,
    }),
    z.object({
        kind: z.literal('planet_claimed'),
        planet: GameEventPlanetRefSchema,
        sectorNumber: Int,
        claimedBy: GameEventPlayerRefSchema,
        owner: GameEventOwnedRefSchema,
    }),
    z.object({
        kind: z.literal('port_built'),
        portId: Int,
        portName: Str,
        sectorNumber: Int,
        owner: GameEventOwnerRefSchema,
    }),
    z.object({
        kind: z.literal('base_upgraded'),
        planet: GameEventPlanetRefSchema,
        sectorNumber: Int,
        level: Int,
    }),
]);
export type GameEvent = z.infer<typeof GameEventSchema>;
export type GameEventKind = GameEvent['kind'];

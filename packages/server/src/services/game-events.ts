import type { GameEvent, GameEventKind } from '@twnr/shared';
import type { Queryable } from '../db/types.js';
import { insertGameEvent, type GameEventVisibility } from '../db/queries/game-events.js';

const VISIBILITY_BY_KIND: Record<GameEventKind, GameEventVisibility> = {
    player_ship_destroyed_by_ship_combat: 'galactic',
    player_ship_destroyed_by_sector_defenses: 'galactic',
    planet_collision: 'galactic',
    planet_destroyed: 'galactic',
    player_joined_universe: 'galactic',
    player_issued_ship: 'galactic',
    clan_created: 'galactic',
    player_joined_clan: 'galactic',
    player_left_clan: 'galactic',
    player_kicked_from_clan: 'galactic',
    clan_disbanded: 'galactic',
    planet_claimed: 'galactic',
    port_built: 'galactic',
    base_upgraded: 'galactic',
};

export async function recordGameEvent(
    universeId: number,
    event: GameEvent,
    db: Queryable,
): Promise<void> {
    const { kind, ...payload } = event;
    await insertGameEvent(universeId, kind, VISIBILITY_BY_KIND[kind], payload, db);
}

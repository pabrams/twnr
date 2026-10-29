import type { Queryable } from '../db/types.js';
import { insertGameEvent, type GameEventVisibility } from '../db/queries/game-events.js';
import type { OwnerRef } from './owner.js';

export type PlayerRef = { playerId: number; name: string };
export type ClanRef = { clanId: number; clanNumber: number; name: string };
export type PlanetRef = { planetId: number; name: string };
export type ShipTypeRef = { slug: string; displayName: string | null };

export type GameEvent =
    | {
          kind: 'player_ship_destroyed_by_ship_combat';
          attacker: PlayerRef;
          victim: PlayerRef;
          destroyedShipType: ShipTypeRef;
          sectorNumber: number;
      }
    | {
          kind: 'player_ship_destroyed_by_sector_defenses';
          victim: PlayerRef;
          destroyedShipType: ShipTypeRef;
          defenseType: 'drones' | 'mines';
          defenseOwner: OwnerRef;
          sectorNumber: number;
      }
    // Collisions are scheduled (planet_collisions) but nothing resolves them yet, so no producer.
    | {
          kind: 'planet_collision';
          planet: PlanetRef;
          collidingWith: PlanetRef;
          sectorNumber: number;
      }
    | {
          kind: 'planet_destroyed';
          destroyer: PlayerRef;
          planet: PlanetRef;
          sectorNumber: number;
      }
    | { kind: 'player_joined_universe'; player: PlayerRef }
    | { kind: 'player_issued_ship'; player: PlayerRef; shipId: number; shipType: ShipTypeRef }
    | { kind: 'clan_created'; founder: PlayerRef; clan: ClanRef }
    | { kind: 'player_joined_clan'; player: PlayerRef; clan: ClanRef }
    | { kind: 'player_left_clan'; player: PlayerRef; clan: ClanRef }
    | { kind: 'player_kicked_from_clan'; player: PlayerRef; kickedBy: PlayerRef; clan: ClanRef }
    | { kind: 'clan_disbanded'; clan: ClanRef; lastMember: PlayerRef }
    | {
          kind: 'planet_claimed';
          planet: PlanetRef;
          sectorNumber: number;
          claimedBy: PlayerRef;
          owner: Exclude<OwnerRef, { kind: 'rogue' }>;
      }
    | {
          kind: 'port_built';
          portId: number;
          portName: string;
          sectorNumber: number;
          owner: OwnerRef;
      }
    | { kind: 'base_upgraded'; planet: PlanetRef; sectorNumber: number; level: number };

export type GameEventKind = GameEvent['kind'];

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

/** Pass the transaction client of the mutation being recorded so the event commits or rolls back with it. */
export async function recordGameEvent(
    universeId: number,
    event: GameEvent,
    db: Queryable,
): Promise<void> {
    const { kind, ...payload } = event;
    await insertGameEvent(universeId, kind, VISIBILITY_BY_KIND[kind], payload, db);
}

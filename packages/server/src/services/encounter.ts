import { players } from '../state/players.js';
import { hasEnemyDronesInSector } from '../db/queries/drones.js';

/**
 * Derived predicate: a player is "in a drone encounter" iff their current
 * sector contains drones not owned by them. No in-memory flag — every gate
 * site queries this on demand. See `project_encounter_rules.md`.
 */
export async function isInEncounter(playerId: number): Promise<boolean> {
    const player = players[playerId];
    if (!player) return false;
    return hasEnemyDronesInSector(player.sector, player.universeId, playerId);
}

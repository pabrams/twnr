import { onlinePlayers } from '../state/players.js';
import { hasEnemyDronesInSector } from '../db/queries/drones.js';

/**
 * A player is "in a drone encounter" iff their current
 * sector contains drones not owned by them.
 */
export async function isInEncounter(playerId: number): Promise<boolean> {
    const player = onlinePlayers[playerId];
    if (!player) return false;
    return hasEnemyDronesInSector(player.sector, player.universeId, playerId);
}

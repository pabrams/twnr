import { onlinePlayers } from '../state/players.js';
import { hasEnemyDronesInSector } from '../db/queries/drones.js';

export async function isInEncounter(playerId: number): Promise<boolean> {
    const player = onlinePlayers[playerId];
    if (!player) return false;
    return hasEnemyDronesInSector(player.sector, player.universeId, playerId);
}

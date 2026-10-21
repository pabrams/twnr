import { clearPlayerShip, applyRespawnReset, getRespawnInfo } from '../db/queries/player.js';
import { getSectorDbId } from '../db/queries/sector.js';
import { deleteShipByOwner } from '../db/queries/ship.js';
import { universeConfig } from '@twnr/shared';

export type RespawnOutcome =
    | { kind: 'no-respawn' }
    | { kind: 'wait'; remainingSeconds: number }
    | { kind: 'respawned' };

export async function tryRespawnPlayer(playerId: number): Promise<RespawnOutcome> {
    const row = await getRespawnInfo(playerId);
    if (!row || !row.ship_destroyed_date) return { kind: 'no-respawn' };

    const delaySecs = row.respawn_delay_seconds ?? universeConfig.respawnDelaySeconds;
    const elapsedSecs = (Date.now() - new Date(row.ship_destroyed_date).getTime()) / 1000;
    if (elapsedSecs < delaySecs) {
        return { kind: 'wait', remainingSeconds: Math.ceil(delaySecs - elapsedSecs) };
    }

    const startSectorId = await getSectorDbId(universeConfig.startingSector, row.universe_id);
    if (startSectorId === undefined) return { kind: 'no-respawn' };

    await clearPlayerShip(playerId);
    await deleteShipByOwner(playerId);

    await applyRespawnReset(playerId, startSectorId, universeConfig.startingCredits);
    return { kind: 'respawned' };
}

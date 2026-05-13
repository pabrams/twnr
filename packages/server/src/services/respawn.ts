import { pool } from '../db/index.js';
import { clearPlayerShip, applyRespawnReset } from '../db/queries/player.js';
import { getSectorDbId } from '../db/queries/sector.js';
import { deleteShipByOwner } from '../db/queries/ship.js';
import { universeConfig } from '../universe-config.js';

export type RespawnOutcome =
    | { kind: 'no-respawn' }
    | { kind: 'wait'; remainingSeconds: number }
    | { kind: 'respawned' };

/**
 * Single source of truth for ship-destroyed respawn handling. Reads the
 * player's `ship_destroyed_date` and the universe's `respawn_delay_seconds`
 * and returns one of:
 *
 *   - 'no-respawn': player isn't flagged as destroyed; carry on.
 *   - 'wait': delay hasn't elapsed; caller should reject the session.
 *   - 'respawned': delay elapsed; this call cleared the destroyed flag and
 *     issued a fresh starting ship + sector + credits.
 *
 * Both the HTTP login route and the WebSocket connect path call this so the
 * destruction → respawn transition lives in one place.
 */
export async function tryRespawnPlayer(playerId: number): Promise<RespawnOutcome> {
    const res = await pool.query<{
        ship_destroyed_date: Date | null;
        universe_id: number;
        respawn_delay_seconds: number | null;
    }>(
        `SELECT p.ship_destroyed_date, p.universe_id, us.respawn_delay_seconds
         FROM players p
         LEFT JOIN universe_settings us ON us.universe_id = p.universe_id
         WHERE p.id = $1`,
        [playerId],
    );
    const row = res.rows[0];
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

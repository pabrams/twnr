import { onlinePlayers } from '../state/players.js';
import { isGuestUser, deleteUserById } from '../db/queries/user.js';
import {
    deleteVisitedSectorsForPlayers,
    clearShipIdsForPlayers,
    deleteShipsByOwners,
    deletePlayerById,
} from '../db/queries/player.js';
import { pool } from '../db/index.js';

/**
 * Hard-delete a single guest user and all rows tied to them: visited sectors,
 * ships, the player row, and finally the user row. Mirrors the cleanup the
 * WS-close handler used to do inline before guests became persistent.
 */
async function deleteGuestUserById(userId: number, playerId: number): Promise<void> {
    await deleteVisitedSectorsForPlayers([playerId]);
    await clearShipIdsForPlayers([playerId]);
    await deleteShipsByOwners([playerId]);
    await deletePlayerById(playerId);
    await deleteUserById(userId);
}

/**
 * Reaps guest users who haven't been online for `maxIdleDays` (default 7,
 * matching the JWT cookie TTL — past that point the recruiter's browser
 * can't transparently resume them anyway, so the row is dead weight). Skips
 * any guest whose player is currently in the in-memory `players` map, so
 * we never delete someone mid-session.
 *
 */
export async function cleanupExpiredGuests(maxIdleDays = 7): Promise<{ deleted: number }> {
    const onlinePlayerIds = new Set(Object.keys(onlinePlayers).map(Number));

    const res = await pool.query<{ user_id: number; player_id: number }>(
        `SELECT u.id AS user_id, p.id AS player_id
           FROM users u
           JOIN players p ON p.user_id = u.id
          WHERE u.is_guest = true
            AND COALESCE(p.last_logout_at, p.last_login_at) < NOW() - ($1 || ' days')::interval`,
        [maxIdleDays],
    );

    let deleted = 0;
    for (const row of res.rows) {
        if (onlinePlayerIds.has(row.player_id)) continue;
        if (!(await isGuestUser(row.user_id))) continue;
        await deleteGuestUserById(row.user_id, row.player_id);
        deleted++;
    }
    return { deleted };
}

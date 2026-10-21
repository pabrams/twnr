import { onlinePlayers } from '../state/players.js';
import { isGuestUser, deleteUserById, listExpiredGuests } from '../db/queries/user.js';
import {
    deleteVisitedSectorsForPlayers,
    clearShipIdsForPlayers,
    deleteShipsByOwners,
    deletePlayerById,
} from '../db/queries/player.js';

async function deleteGuestUserById(userId: number, playerId: number): Promise<void> {
    await deleteVisitedSectorsForPlayers([playerId]);
    await clearShipIdsForPlayers([playerId]);
    await deleteShipsByOwners([playerId]);
    await deletePlayerById(playerId);
    await deleteUserById(userId);
}

/** Default matches the 7-day JWT cookie TTL — past it the guest's browser can't resume anyway. */
export async function cleanupExpiredGuests(maxIdleDays = 7): Promise<{ deleted: number }> {
    const onlinePlayerIds = new Set(Object.keys(onlinePlayers).map(Number));

    const rows = await listExpiredGuests(maxIdleDays);

    let deleted = 0;
    for (const row of rows) {
        if (onlinePlayerIds.has(row.player_id)) continue;
        if (!(await isGuestUser(row.user_id))) continue;
        await deleteGuestUserById(row.user_id, row.player_id);
        deleted++;
    }
    return { deleted };
}

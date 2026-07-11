import { pool } from '../db/index.js';
import { getPlayerClanId } from '../db/queries/clan.js';

/**
 * Per-player snapshot of what's in a sector — what the player has *seen*,
 * not what's currently there.
 */
export type SectorObservationFlags = {
    friendlyDrones: boolean;
    enemyDrones: boolean;
    friendlyProxMines: boolean;
    enemyProxMines: boolean;
    friendlySeekerMines: boolean;
};

/** Build the flag set for a sector from live state, from this player's POV. */
export async function snapshotSectorForPlayer(
    playerId: number,
    sectorId: number,
): Promise<SectorObservationFlags> {
    const clanId = await getPlayerClanId(playerId);
    const droneRes = await pool.query<{
        owner_player_id: number | null;
        owner_clan_id: number | null;
        quantity: number;
    }>(
        `SELECT owner_player_id, owner_clan_id, quantity
         FROM sector_drones
         WHERE sector_id = $1 AND quantity > 0`,
        [sectorId],
    );
    const mineRes = await pool.query<{
        mine_type: 'proximity' | 'seeker';
        owner_player_id: number | null;
        owner_clan_id: number | null;
        quantity: number;
    }>(
        `SELECT mine_type, owner_player_id, owner_clan_id, quantity
         FROM sector_mines
         WHERE sector_id = $1 AND quantity > 0`,
        [sectorId],
    );

    const isFriendly = (ownerPlayer: number | null, ownerClan: number | null): boolean =>
        ownerPlayer === playerId || (clanId !== null && ownerClan === clanId);

    let friendlyDrones = false;
    let enemyDrones = false;
    for (const r of droneRes.rows) {
        if (isFriendly(r.owner_player_id, r.owner_clan_id)) friendlyDrones = true;
        else enemyDrones = true;
    }

    let friendlyProxMines = false;
    let enemyProxMines = false;
    let friendlySeekerMines = false;
    for (const r of mineRes.rows) {
        const friendly = isFriendly(r.owner_player_id, r.owner_clan_id);
        if (r.mine_type === 'proximity') {
            if (friendly) friendlyProxMines = true;
            else enemyProxMines = true;
        } else if (r.mine_type === 'seeker' && friendly) {
            friendlySeekerMines = true;
        }
    }

    return {
        friendlyDrones,
        enemyDrones,
        friendlyProxMines,
        enemyProxMines,
        friendlySeekerMines,
    };
}

/** Upsert the player's observation row with the given flags. */
export async function writeSectorObservation(
    playerId: number,
    sectorId: number,
    flags: SectorObservationFlags,
): Promise<void> {
    await pool.query(
        `INSERT INTO player_sector_observations
           (player_id, sector_id, friendly_drones, enemy_drones,
            friendly_prox_mines, enemy_prox_mines, friendly_seeker_mines,
            last_observed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (player_id, sector_id) DO UPDATE
         SET friendly_drones = EXCLUDED.friendly_drones,
             enemy_drones = EXCLUDED.enemy_drones,
             friendly_prox_mines = EXCLUDED.friendly_prox_mines,
             enemy_prox_mines = EXCLUDED.enemy_prox_mines,
             friendly_seeker_mines = EXCLUDED.friendly_seeker_mines,
             last_observed_at = NOW()`,
        [
            playerId,
            sectorId,
            flags.friendlyDrones,
            flags.enemyDrones,
            flags.friendlyProxMines,
            flags.enemyProxMines,
            flags.friendlySeekerMines,
        ],
    );
}

/** Snapshot + write. Use this from sector-entry / deploy / destruction sites. */
export async function refreshSectorObservation(playerId: number, sectorId: number): Promise<void> {
    const flags = await snapshotSectorForPlayer(playerId, sectorId);
    await writeSectorObservation(playerId, sectorId, flags);
}

/** Bulk-load observations for a list of sectors (used by the neighborhood
 *  query so a single round trip covers the whole viewport). */
export async function listSectorObservations(
    playerId: number,
    sectorIds: number[],
): Promise<Map<number, SectorObservationFlags>> {
    const out = new Map<number, SectorObservationFlags>();
    if (sectorIds.length === 0) return out;
    const res = await pool.query<{
        sector_id: number;
        friendly_drones: boolean;
        enemy_drones: boolean;
        friendly_prox_mines: boolean;
        enemy_prox_mines: boolean;
        friendly_seeker_mines: boolean;
    }>(
        `SELECT sector_id, friendly_drones, enemy_drones,
                friendly_prox_mines, enemy_prox_mines, friendly_seeker_mines
         FROM player_sector_observations
         WHERE player_id = $1 AND sector_id = ANY($2::int[])`,
        [playerId, sectorIds],
    );
    for (const r of res.rows) {
        out.set(r.sector_id, {
            friendlyDrones: r.friendly_drones,
            enemyDrones: r.enemy_drones,
            friendlyProxMines: r.friendly_prox_mines,
            enemyProxMines: r.enemy_prox_mines,
            friendlySeekerMines: r.friendly_seeker_mines,
        });
    }
    return out;
}

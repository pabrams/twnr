import { getPlayerClanId } from '../db/queries/clan.js';
import { getSectorDroneOwners } from '../db/queries/drones.js';
import { getSectorMineOwners } from '../db/queries/mines.js';
import { upsertSectorObservation, listSectorObservationRows } from '../db/queries/observations.js';

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
    const droneRows = await getSectorDroneOwners(sectorId);
    const mineRows = await getSectorMineOwners(sectorId);

    const isFriendly = (ownerPlayer: number | null, ownerClan: number | null): boolean =>
        ownerPlayer === playerId || (clanId !== null && ownerClan === clanId);

    let friendlyDrones = false;
    let enemyDrones = false;
    for (const r of droneRows) {
        if (isFriendly(r.owner_player_id, r.owner_clan_id)) friendlyDrones = true;
        else enemyDrones = true;
    }

    let friendlyProxMines = false;
    let enemyProxMines = false;
    let friendlySeekerMines = false;
    for (const r of mineRows) {
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
    await upsertSectorObservation(playerId, sectorId, {
        friendly_drones: flags.friendlyDrones,
        enemy_drones: flags.enemyDrones,
        friendly_prox_mines: flags.friendlyProxMines,
        enemy_prox_mines: flags.enemyProxMines,
        friendly_seeker_mines: flags.friendlySeekerMines,
    });
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
    const rows = await listSectorObservationRows(playerId, sectorIds);
    for (const r of rows) {
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

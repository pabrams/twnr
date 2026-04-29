import { getWarpRefsForPlayer, getSectorDbId } from '../db/queries/sector.js';
import { getAbandonedShipsInSector } from '../db/queries/ship.js';
import { getSectorDroneDisplayInfo } from '../db/queries/drones.js';
import { getPortForSectorDisplay } from '../db/queries/port.js';
import { getVisitedSectorNumbers } from '../db/queries/player.js';
import { portName } from '../domain/port-classes.js';

/** Sector numbers the player has marked visited, in ascending order. */
export async function getVisitedSectors(playerId: number): Promise<number[]> {
    return getVisitedSectorNumbers(playerId);
}

/** Adjacent sectors of `sectorNumber` from the player's POV (with visited flags). */
export async function getWarpRefs(
    playerId: number,
    sectorNumber: number,
    universeId: number,
): Promise<{ sector: number; visited: boolean }[]> {
    return getWarpRefsForPlayer(playerId, sectorNumber, universeId);
}

/**
 * Port summary for display. Returns null if no port exists in that sector.
 * The display name is synthesised from the sector number rather than stored.
 */
export async function getPortForSector(
    sectorNumber: number,
    universeId: number,
): Promise<{ class: number; name: string } | null> {
    const row = await getPortForSectorDisplay(sectorNumber, universeId);
    if (!row) return null;
    return { class: row.class, name: portName(sectorNumber) };
}

export async function getSectorDrones(
    sectorNumber: number,
    universeId: number,
): Promise<{ quantity: number; ownerId: number | null; ownerName: string } | null> {
    return getSectorDroneDisplayInfo(sectorNumber, universeId);
}

/** Abandoned ships sitting in the sector (typically from destroyed players). */
export async function getEmptyShipsInSector(
    sectorNumber: number,
    universeId: number,
): Promise<{ id: number; name: string; typeName: string; ownerName: string }[]> {
    const rows = await getAbandonedShipsInSector(sectorNumber, universeId);
    return rows.map((r) => ({
        id: r.id,
        name: r.typeName,
        typeName: r.typeName,
        ownerName: r.ownerName,
    }));
}

/** Translate a sector's player-facing number into its DB primary key. */
export async function resolveSectorId(sectorNumber: number, universeId: number): Promise<number> {
    const id = await getSectorDbId(sectorNumber, universeId);
    return id as number;
}

import type { OwnershipInfo } from '@twnr/shared';
import { getWarpRefsForPlayer, getSectorDbId } from '../db/queries/sector.js';
import { getAbandonedShipsInSector } from '../db/queries/ship.js';
import { getSectorDroneDisplayInfo } from '../db/queries/drones.js';
import { getPortForSectorDisplay } from '../db/queries/port.js';
import { getVisitedSectorNumbers } from '../db/queries/player.js';
import { ownershipFrom } from './owner-format.js';

export async function getVisitedSectors(playerId: number): Promise<number[]> {
    return getVisitedSectorNumbers(playerId);
}

/** Adjacent sectors of `sectorNumber` from the player's POV. */
export async function getWarpRefs(
    playerId: number,
    sectorNumber: number,
    universeId: number,
): Promise<{ sector: number; visited: boolean }[]> {
    return getWarpRefsForPlayer(playerId, sectorNumber, universeId);
}

export async function getPortForSector(
    sectorNumber: number,
    universeId: number,
): Promise<{ class: number; name: string } | null> {
    const row = await getPortForSectorDisplay(sectorNumber, universeId);
    if (!row) return null;
    return { class: row.class, name: row.name };
}

export async function getSectorDrones(
    sectorNumber: number,
    universeId: number,
): Promise<{ quantity: number; ownerId: number | null; ownership: OwnershipInfo } | null> {
    return getSectorDroneDisplayInfo(sectorNumber, universeId);
}

export async function getEmptyShipsInSector(
    sectorNumber: number,
    universeId: number,
): Promise<
    {
        id: number;
        name: string;
        typeName: string;
        typeDisplayName: string | null;
        ownership: OwnershipInfo;
    }[]
> {
    const rows = await getAbandonedShipsInSector(sectorNumber, universeId);
    return rows.map((r) => ({
        id: r.id,
        name: r.typeName,
        typeName: r.typeName,
        typeDisplayName: r.typeDisplayName,
        ownership: ownershipFrom(r),
    }));
}

export async function resolveSectorId(sectorNumber: number, universeId: number): Promise<number> {
    const id = await getSectorDbId(sectorNumber, universeId);
    return id as number;
}

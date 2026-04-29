import { getPlanetsInSector, getCollisionsInSector, getSectorDbId } from '../db/queries/sector.js';
import { recordSectorObservation } from '../db/queries/observations.js';
import { players } from '../state/players.js';
import {
    getPortForSector,
    getWarpRefs,
    getSectorDrones,
    getEmptyShipsInSector,
} from './sector-lookup.js';

/**
 * Build the full payload describing what a player sees when they look at
 * a sector — port, warps, drones, planets, collisions, abandoned ships,
 * and other players present. Also records the player's observation for
 * fog-of-war so the minimap can later show what they've seen.
 *
 * `sectorNumber` defaults to the player's current sector. Returns null if
 * the player isn't in the registry (offline / disconnected).
 */
export async function buildSectorDisplayData(playerId: number, sectorNumber?: number) {
    const player = players[playerId];
    if (!player) return null;
    const sector = sectorNumber ?? player.sector;
    const universeId = player.universeId;

    const [port, warps, sectorDrones, planets, collisions, emptyShips, sectorDbId] =
        await Promise.all([
            getPortForSector(sector, universeId),
            getWarpRefs(playerId, sector, universeId),
            getSectorDrones(sector, universeId),
            getPlanetsInSector(sector, universeId),
            getCollisionsInSector(sector, universeId),
            getEmptyShipsInSector(sector, universeId),
            getSectorDbId(sector, universeId),
        ]);

    const playersInSector = Object.entries(players)
        .filter(
            ([id, p]) =>
                p.sector === sector &&
                p.universeId === universeId &&
                !p.docked &&
                Number(id) !== playerId,
        )
        .map(([id, p]) => ({ id: Number(id), name: p.name }));

    // Fog-of-war: record the player's observation of this sector's contents.
    if (sectorDbId !== undefined) {
        await recordSectorObservation(
            playerId,
            sectorDbId,
            port ? { class: port.class } : null,
            planets.map((p) => ({ name: p.name, type: p.type ?? null })),
        ).catch((err) => console.error('recordSectorObservation failed:', err));
    }

    return {
        sector,
        warps,
        players: playersInSector,
        port,
        sectorDrones,
        planets,
        ships: emptyShips.length > 0 ? emptyShips : undefined,
        collisions,
    };
}

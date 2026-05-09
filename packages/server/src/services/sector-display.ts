import { getPlanetsInSector, getCollisionsInSector, getSectorDbId } from '../db/queries/sector.js';
import { getSectorMines } from '../db/queries/mines.js';
import { recordSectorObservation } from '../db/queries/observations.js';
import { listPlayersInSector } from '../db/queries/player.js';
import { players, isVisibleInSector } from '../state/players.js';
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

    const sectorMines =
        sectorDbId !== undefined
            ? (await getSectorMines(sectorDbId))
                  .filter((m) => m.quantity > 0)
                  .filter((m) => m.mine_type !== 'seeker' || m.owner_player_id === playerId)
                  .map((m) => ({
                      mineType: m.mine_type,
                      quantity: m.quantity,
                      own: m.owner_player_id === playerId,
                  }))
            : [];

    const sectorPlayerRows = await listPlayersInSector(sector, universeId, playerId);
    const playersInSector = sectorPlayerRows
        .filter((row) => isVisibleInSector(row.id, row.docked, row.on_planet_id))
        .map((row) => ({ id: row.id, name: row.name }));

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
        sectorMines: sectorMines.length > 0 ? sectorMines : undefined,
    };
}

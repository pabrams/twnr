import { getPlanetsInSector, getCollisionsInSector, getSectorDbId } from '../db/queries/sector.js';
import { getSectorMines } from '../db/queries/mines.js';
import { recordSectorObservation } from '../db/queries/observations.js';
import { listPlayersInSector } from '../db/queries/player.js';
import { getPlayerClanId } from '../db/queries/clan.js';
import { getSectorBeacon } from '../db/queries/beacons.js';
import { players, isVisibleInSector } from '../state/players.js';
import { isFriendlyOwner } from './owner.js';
import { ownershipFrom } from './owner-format.js';
import {
    getPortForSector,
    getWarpRefs,
    getSectorDrones,
    getEmptyShipsInSector,
} from './sector-lookup.js';

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

    const viewerClanId = await getPlayerClanId(playerId);

    const sectorMines =
        sectorDbId !== undefined
            ? (await getSectorMines(sectorDbId))
                  .filter((m) => m.quantity > 0)
                  .filter(
                      (m) =>
                          m.mine_type !== 'seeker' || isFriendlyOwner(m, playerId, viewerClanId),
                  )
                  .map((m) => ({
                      mineType: m.mine_type,
                      quantity: m.quantity,
                      own: isFriendlyOwner(m, playerId, viewerClanId),
                      ownership: ownershipFrom(m),
                  }))
            : [];

    const sectorPlayerRows = await listPlayersInSector(sector, universeId, playerId);
    const playersInSector = sectorPlayerRows
        .filter((row) => isVisibleInSector(row.id, row.docked, row.on_planet_id))
        .map((row) => ({
            id: row.id,
            name: row.name,
            clanNumber: row.clan_number,
            shipName: row.ship_name ?? '',
            shipTypeName: row.ship_type_name ?? '',
            shipTypeDisplayName: row.ship_display_name,
            drones: row.ship_drones,
        }));

    const beaconRow = sectorDbId !== undefined ? await getSectorBeacon(sectorDbId) : undefined;
    const beacon = beaconRow
        ? { message: beaconRow.message, ownership: ownershipFrom(beaconRow) }
        : null;

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
        beacon,
    };
}

import { ServerMsgType } from '@twnr/shared';
import { sendEnvelope, sendError } from '../state/messaging.js';
import { players } from '../state/players.js';
import { getShipInfo, getPlayerOwnedShips } from '../db/queries/ship.js';
import { getShipHardwareQuantities, getShipTypeHardwareMax } from '../db/queries/hardware.js';
import { getGraph } from '../state/graph-cache.js';
import { cargoUsed } from './cargo-utils.js';

export async function handleShipInfo(playerId: number): Promise<void> {
    const row = await getShipInfo(playerId);
    if (!row) {
        sendError(playerId, 'Ship not found');
        return;
    }

    const hwRows = await getShipHardwareQuantities(row.ship_id);
    const hardware: Record<string, number> = Object.fromEntries(
        hwRows.map((r) => [r.name, r.quantity]),
    );

    const hwMaxRows = await getShipTypeHardwareMax(row.ship_type_id);
    const hardwareMax: Record<string, number> = Object.fromEntries(
        hwMaxRows.map((r) => [r.name, r.max_quantity]),
    );

    const holdsAvailable = row.holds - cargoUsed(row);
    sendEnvelope(playerId, {
        type: ServerMsgType.ShipInfoResult,
        playerId,
        shipName: row.ship_name,
        coloredShipName: row.ship_display_name,
        drones: row.drones,
        shields: row.shields,
        maxDrones: row.max_drones,
        maxShields: row.max_shields,
        cargoLimit: row.holds,
        maxHolds: row.max_holds,
        cargoFuel: row.fuel,
        cargoOrganics: row.organics,
        cargoEquipment: row.equipment,
        cargoColonists: row.colonists,
        holdsAvailable,
        hardware,
        hardwareMax,
        turnsPerWarp: row.turns_per_warp,
        hasHyperwarpDrive: (hardware.hyperspace_1 || 0) > 0 || (hardware.hyperspace_2 || 0) > 0,
        turns: row.turns,
        credits: row.credits,
    });
}

export async function handleListOwnedShips(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const rows = await getPlayerOwnedShips(playerId);

    const warps = await getGraph(player.universeId);
    const hopsBySector = new Map<number, number>();
    hopsBySector.set(player.sector, 0);
    const queue: number[] = [player.sector];
    while (queue.length > 0) {
        const s = queue.shift()!;
        const d = hopsBySector.get(s)!;
        for (const n of warps[s] ?? []) {
            if (hopsBySector.has(n)) continue;
            hopsBySector.set(n, d + 1);
            queue.push(n);
        }
    }

    sendEnvelope(playerId, {
        type: ServerMsgType.ListOwnedShipsResult,
        currentSector: player.sector,
        currentShipId: player.shipId,
        ships: rows.map((r) => ({
            id: r.id,
            shipNumber: r.universe_ship_number,
            sector: r.sector_number,
            drones: r.drones,
            shields: r.shields,
            holds: r.holds,
            hops: r.sector_number !== null ? (hopsBySector.get(r.sector_number) ?? null) : null,
            typeName: r.type_name,
            typeDisplayName: r.type_display_name,
        })),
    });
}

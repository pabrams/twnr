import { ServerMsgType } from '@twnr/shared';
import { pool } from '../db/index.js';
import { sendEnvelope, sendError } from '../state/messaging.js';
import { players } from '../state/players.js';
import { getShipInfo, getPlayerOwnedShips } from '../db/queries/ship.js';
import { getShipHardwareQuantities, getShipTypeHardwareMax } from '../db/queries/hardware.js';
import {
    getOnPlanetId,
    moveToSector,
    markSectorVisited,
    setPlayerShipId,
} from '../db/queries/player.js';
import { getPlayerTurns } from '../db/queries/turn.js';
import { getGraph } from '../state/graph-cache.js';
import { checkAndDeductTurns } from '../turn-logic.js';
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

    const currentShip = rows.find((r) => r.id === player.shipId) ?? null;

    sendEnvelope(playerId, {
        type: ServerMsgType.ListOwnedShipsResult,
        currentSector: player.sector,
        currentShipId: player.shipId,
        currentShipTypeName: currentShip?.type_name ?? null,
        currentShipTypeDisplayName: currentShip?.type_display_name ?? null,
        currentShipTransporterRange: currentShip?.transporter_range ?? null,
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
            transporterRange: r.transporter_range,
        })),
    });
}

export async function handleTransportToShip(playerId: number, shipId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (player.docked || player.at_starbase) {
        sendError(playerId, 'Cannot use the transporter while docked');
        return;
    }
    if (await getOnPlanetId(playerId)) {
        sendError(playerId, 'Cannot use the transporter while on a planet');
        return;
    }

    const lookup = await pool.query<{
        current_range: number | null;
        target_sector_id: number | null;
        target_sector_number: number | null;
    }>(
        `SELECT cur_st.transporter_range AS current_range,
                tgt.sector_id AS target_sector_id,
                tgt_sec.sector_number AS target_sector_number
         FROM ships tgt
         LEFT JOIN sectors tgt_sec ON tgt.sector_id = tgt_sec.id
         LEFT JOIN players p ON p.id = $1
         LEFT JOIN ships cur ON cur.id = p.ship_id
         LEFT JOIN ship_types cur_st ON cur_st.id = cur.ship_type_id
         WHERE tgt.id = $2 AND tgt.owner_player_id = $1`,
        [playerId, shipId],
    );
    const row = lookup.rows[0];
    if (!row || row.target_sector_id === null || row.target_sector_number === null) {
        sendError(playerId, 'Target ship not found');
        return;
    }
    if (player.shipId === shipId) {
        sendError(playerId, 'Already on that ship');
        return;
    }
    const range = row.current_range ?? 0;

    const warps = await getGraph(player.universeId);
    const hops = bfsHops(warps, player.sector, row.target_sector_number);
    if (hops === null) {
        sendError(playerId, 'No path to target ship');
        return;
    }
    if (hops > range) {
        sendError(playerId, 'Target ship is out of transporter range');
        return;
    }

    const turnResult = await checkAndDeductTurns(playerId, player.universeId, 1);
    if (!turnResult.allowed) {
        sendError(playerId, 'Insufficient turns');
        return;
    }

    await Promise.all([
        setPlayerShipId(playerId, shipId),
        moveToSector(playerId, row.target_sector_id),
        markSectorVisited(playerId, row.target_sector_id),
    ]);
    player.shipId = shipId;
    player.sector = row.target_sector_number;
    player.sectorId = row.target_sector_id;

    const turnsRemaining = (await getPlayerTurns(playerId)) ?? 0;
    sendEnvelope(playerId, {
        type: ServerMsgType.TransportToShipResult,
        targetShipId: shipId,
        targetSector: row.target_sector_number,
        turnsUsed: turnResult.turnsUsed,
        turnsRemaining,
    });
}

function bfsHops(
    warps: Record<number, number[]>,
    from: number,
    to: number,
): number | null {
    if (from === to) return 0;
    const visited = new Set<number>([from]);
    const queue: { s: number; d: number }[] = [{ s: from, d: 0 }];
    while (queue.length > 0) {
        const { s, d } = queue.shift()!;
        for (const n of warps[s] ?? []) {
            if (n === to) return d + 1;
            if (!visited.has(n)) {
                visited.add(n);
                queue.push({ s: n, d: d + 1 });
            }
        }
    }
    return null;
}

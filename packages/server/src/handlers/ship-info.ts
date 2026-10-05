import { ServerTag } from '@twnr/shared';
import type {
    GetShipDetailCommand,
    TransportToShipCommand,
    ChangeShipOwnershipCommand,
} from '@twnr/shared';
import { sendEnvelope, sendError } from '../state/messaging.js';
import { onlinePlayers, getPlayerUniverseId } from '../state/players.js';
import {
    getShipInfo,
    getPlayerOwnedShips,
    setShipOwnership,
    getShipOwnership,
    getOwnedShipDetail,
    getTransportTargetInfo,
} from '../db/queries/ship.js';
import { getShipHardwareQuantities, getShipTypeHardwareMax } from '../db/queries/hardware.js';
import {
    getOnPlanetId,
    moveToSector,
    markSectorVisited,
    setPlayerShipId,
} from '../db/queries/player.js';
import { getPlayerClanId, getClanById } from '../db/queries/clan.js';
import { getPlayerTurns } from '../db/queries/turn.js';
import { getGraph } from '../state/graph-cache.js';
import { checkAndDeductTurns } from '../turn-logic.js';
import { notifyTurnChange } from '../services/notify.js';
import { cargoUsed } from './cargo-utils.js';
import { formatOwner, ownershipFrom } from '../services/owner-format.js';

export async function serveShipInfo(playerId: number): Promise<void> {
    const row = await getShipInfo(playerId);
    if (!row) {
        sendError(playerId, 'Ship not found');
        return;
    }

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) {
        sendError(playerId, 'Player not in a universe.');
        return;
    }

    const hwRows = await getShipHardwareQuantities(row.ship_id);
    const hardware: Record<string, number> = Object.fromEntries(
        hwRows.map((r) => [r.name, r.quantity]),
    );

    const hwMaxRows = await getShipTypeHardwareMax(universeId, row.ship_type_slug);
    const hardwareMax: Record<string, number> = Object.fromEntries(
        hwMaxRows.map((r) => [r.name, r.max_quantity]),
    );

    const clanId = await getPlayerClanId(playerId);
    const clan = clanId !== null ? await getClanById(clanId) : null;

    const holdsAvailable = row.holds - cargoUsed(row);
    sendEnvelope(playerId, {
        type: ServerTag.ShipInfoResult,
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
        clanNumber: clan?.universe_clan_number ?? null,
        clanName: clan?.name ?? null,
    });
}

export async function serveGetShipDetail(
    playerId: number,
    data: GetShipDetailCommand,
): Promise<void> {
    const { shipId } = data;
    const row = await getOwnedShipDetail(shipId, playerId);
    if (!row) {
        sendError(playerId, 'Ship not found or not owned by you.');
        return;
    }

    const hwRows = await getShipHardwareQuantities(row.id);
    const hardware: Record<string, number> = Object.fromEntries(
        hwRows.map((r) => [r.name, r.quantity]),
    );
    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) {
        sendError(playerId, 'Player not in a universe.');
        return;
    }
    const hwMaxRows = await getShipTypeHardwareMax(universeId, row.ship_type_slug);
    const hardwareMax: Record<string, number> = Object.fromEntries(
        hwMaxRows.map((r) => [r.name, r.max_quantity]),
    );

    sendEnvelope(playerId, {
        type: ServerTag.ShipDetailResult,
        shipId: row.id,
        shipNumber: row.universe_ship_number,
        typeName: row.type_name,
        typeDisplayName: row.type_display_name,
        sector: row.sector_number,
        drones: row.drones,
        maxDrones: row.max_drones,
        shields: row.shields,
        maxShields: row.max_shields,
        holds: row.holds,
        maxHolds: row.max_holds,
        transporterRange: row.transporter_range,
        cargoFuel: row.fuel,
        cargoOrganics: row.organics,
        cargoEquipment: row.equipment,
        cargoColonists: row.colonists,
        ownership: ownershipFrom(row),
        hardware,
        hardwareMax,
    });
}

export async function serveListOwnedShips(playerId: number): Promise<void> {
    const player = onlinePlayers[playerId];
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
    const viewerClanId = await getPlayerClanId(playerId);

    sendEnvelope(playerId, {
        type: ServerTag.ListOwnedShipsResult,
        currentSector: player.sector,
        currentShipId: player.shipId,
        currentShipTypeName: currentShip?.type_name ?? null,
        currentShipTypeDisplayName: currentShip?.type_display_name ?? null,
        currentShipTransporterRange: currentShip?.transporter_range ?? null,
        viewerClanId,
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
            ownerPlayerId: r.owner_player_id,
            ownerClanId: r.owner_clan_id,
            ownerLabel: formatOwner(r),
        })),
    });
}

export async function serveTransportToShip(
    playerId: number,
    data: TransportToShipCommand,
): Promise<void> {
    const { shipId } = data;
    const player = onlinePlayers[playerId];
    if (!player) return;

    if (player.docked || player.at_starbase) {
        sendError(playerId, 'Cannot use the transporter while docked');
        return;
    }
    if (await getOnPlanetId(playerId)) {
        sendError(playerId, 'Cannot use the transporter while on a planet');
        return;
    }

    const row = await getTransportTargetInfo(playerId, shipId);
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
    if (turnResult.turnsUsed) {
        notifyTurnChange(playerId, turnResult.turnsUsed, 'transporter pad');
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
        type: ServerTag.TransportToShipResult,
        targetShipId: shipId,
        targetSector: row.target_sector_number,
        turnsUsed: turnResult.turnsUsed,
        turnsRemaining,
    });
}

/** O (Change Ship Ownership): flip current ship between personal and
 *  clan-owned. */
export async function serveChangeShipOwnership(
    playerId: number,
    data: ChangeShipOwnershipCommand,
): Promise<void> {
    const { ownership } = data;
    const player = onlinePlayers[playerId];
    if (!player) return;
    if (player.shipId === null) {
        sendError(playerId, 'No ship.');
        return;
    }

    const current = await getShipOwnership(player.shipId);
    const isPersonal = current?.owner_player_id !== null && current?.owner_player_id !== undefined;
    const isClanOwned = current?.owner_clan_id !== null && current?.owner_clan_id !== undefined;
    const playerClanId = await getPlayerClanId(playerId);

    if (ownership === 'clan') {
        if (playerClanId === null) {
            sendError(playerId, 'You are not in a clan.');
            return;
        }
        if (isClanOwned && current?.owner_clan_id === playerClanId) {
            sendError(playerId, 'Ship is already clan-owned.');
            return;
        }
        await setShipOwnership(player.shipId, null, playerClanId);
    } else {
        if (isPersonal) {
            sendError(playerId, 'Ship is already personal.');
            return;
        }
        if (playerClanId === null) {
            sendError(playerId, 'You are not in a clan; nothing to convert.');
            return;
        }
        const clan = await getClanById(playerClanId);
        if (clan?.leader_id !== playerId) {
            sendError(playerId, 'Only the clan leader can convert a clan ship to personal.');
            return;
        }
        await setShipOwnership(player.shipId, playerId, null);
    }

    sendEnvelope(playerId, {
        type: ServerTag.ChangeShipOwnershipResult,
        shipId: player.shipId,
        ownership,
    });
}

function bfsHops(warps: Record<number, number[]>, from: number, to: number): number | null {
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

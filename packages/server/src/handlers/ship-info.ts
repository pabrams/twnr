import type { CommandRequest } from '@twnr/shared';
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
import { type CommandResult, commandError } from './command.js';

export async function serveShipInfo(playerId: number): Promise<CommandResult<'ShipInfo'>> {
    const row = await getShipInfo(playerId);
    if (!row) {
        return commandError('Ship not found');
    }

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) {
        return commandError('Player not in a universe.');
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
    return {
        playerId,
        shipTypeName: row.ship_type_name,
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
    };
}

export async function serveGetShipDetail(
    playerId: number,
    data: CommandRequest<'GetShipDetail'>,
): Promise<CommandResult<'GetShipDetail'>> {
    const { shipId } = data;
    const row = await getOwnedShipDetail(shipId, playerId);
    if (!row) {
        return commandError('Ship not found or not owned by you.');
    }

    const hwRows = await getShipHardwareQuantities(row.id);
    const hardware: Record<string, number> = Object.fromEntries(
        hwRows.map((r) => [r.name, r.quantity]),
    );
    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) {
        return commandError('Player not in a universe.');
    }
    const hwMaxRows = await getShipTypeHardwareMax(universeId, row.ship_type_slug);
    const hardwareMax: Record<string, number> = Object.fromEntries(
        hwMaxRows.map((r) => [r.name, r.max_quantity]),
    );

    return {
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
    };
}

export async function serveListOwnedShips(
    playerId: number,
): Promise<CommandResult<'ListOwnedShips'>> {
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

    return {
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
    };
}

export async function serveTransportToShip(
    playerId: number,
    data: CommandRequest<'TransportToShip'>,
): Promise<CommandResult<'TransportToShip'>> {
    const { shipId } = data;
    const player = onlinePlayers[playerId];
    if (!player) return;

    if (player.docked || player.at_starbase) {
        return commandError('Cannot use the transporter while docked');
    }
    if (await getOnPlanetId(playerId)) {
        return commandError('Cannot use the transporter while on a planet');
    }

    const row = await getTransportTargetInfo(playerId, shipId);
    if (!row || row.target_sector_id === null || row.target_sector_number === null) {
        return commandError('Target ship not found');
    }
    if (player.shipId === shipId) {
        return commandError('Already on that ship');
    }
    const range = row.current_range ?? 0;

    const warps = await getGraph(player.universeId);
    const hops = bfsHops(warps, player.sector, row.target_sector_number);
    if (hops === null) {
        return commandError('No path to target ship');
    }
    if (hops > range) {
        return commandError('Target ship is out of transporter range');
    }

    const turnResult = await checkAndDeductTurns(playerId, player.universeId, 1);
    if (!turnResult.allowed) {
        return commandError('Insufficient turns');
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
    player.shipName = row.target_ship_name;
    player.sector = row.target_sector_number;
    player.sectorId = row.target_sector_id;

    const turnsRemaining = (await getPlayerTurns(playerId)) ?? 0;
    return {
        targetShipId: shipId,
        targetSector: row.target_sector_number,
        turnsUsed: turnResult.turnsUsed,
        turnsRemaining,
    };
}

export async function serveChangeShipOwnership(
    playerId: number,
    data: CommandRequest<'ChangeShipOwnership'>,
): Promise<CommandResult<'ChangeShipOwnership'>> {
    const { ownership } = data;
    const player = onlinePlayers[playerId];
    if (!player) return;
    if (player.shipId === null) {
        return commandError('No ship.');
    }

    const current = await getShipOwnership(player.shipId);
    const isPersonal = current?.owner_player_id !== null && current?.owner_player_id !== undefined;
    const isClanOwned = current?.owner_clan_id !== null && current?.owner_clan_id !== undefined;
    const playerClanId = await getPlayerClanId(playerId);

    if (ownership === 'clan') {
        if (playerClanId === null) {
            return commandError('You are not in a clan.');
        }
        if (isClanOwned && current?.owner_clan_id === playerClanId) {
            return commandError('Ship is already clan-owned.');
        }
        await setShipOwnership(player.shipId, null, playerClanId);
    } else {
        if (isPersonal) {
            return commandError('Ship is already personal.');
        }
        if (playerClanId === null) {
            return commandError('You are not in a clan; nothing to convert.');
        }
        const clan = await getClanById(playerClanId);
        if (clan?.leader_id !== playerId) {
            return commandError('Only the clan leader can convert a clan ship to personal.');
        }
        await setShipOwnership(player.shipId, playerId, null);
    }

    return {
        shipId: player.shipId,
        ownership,
    };
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

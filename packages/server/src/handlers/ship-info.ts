import { ServerTag } from '@twnr/shared';
import type {
    GetShipDetailCommand,
    TransportToShipCommand,
    ChangeShipOwnershipCommand,
} from '@twnr/shared';
import { pool } from '../db/index.js';
import { sendEnvelope, sendError } from '../state/messaging.js';
import { players, getPlayerUniverseId } from '../state/players.js';
import {
    getShipInfo,
    getPlayerOwnedShips,
    setShipOwnership,
    getShipOwnership,
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
    const res = await pool.query<{
        id: number;
        universe_ship_number: number;
        type_name: string;
        type_display_name: string | null;
        ship_type_slug: string;
        sector_number: number | null;
        drones: number;
        max_drones: number;
        shields: number;
        max_shields: number;
        holds: number;
        max_holds: number;
        transporter_range: number;
        fuel: number;
        organics: number;
        equipment: number;
        colonists: number;
        owner_player_id: number | null;
        owner_clan_id: number | null;
        owner_player_name: string | null;
        owner_clan_name: string | null;
        owner_clan_number: number | null;
    }>(
        `SELECT sh.id, sh.universe_ship_number,
                st.slug AS type_name, st.display_name AS type_display_name,
                st.slug AS ship_type_slug,
                sec.sector_number,
                sh.drones, st.max_drones,
                sh.shields, st.max_shields,
                sh.holds, st.max_holds,
                st.transporter_range,
                sh.fuel, sh.organics, sh.equipment, sh.colonists,
                sh.owner_player_id, sh.owner_clan_id,
                op.name AS owner_player_name,
                oc.name AS owner_clan_name,
                oc.universe_clan_number AS owner_clan_number
         FROM ships sh
         JOIN universe_ship_types st ON st.universe_id = sh.universe_id AND st.slug = sh.ship_type_slug
         LEFT JOIN sectors sec ON sh.sector_id = sec.id
         LEFT JOIN players op ON op.id = sh.owner_player_id
         LEFT JOIN clans oc ON oc.id = sh.owner_clan_id
         WHERE sh.id = $1
           AND (sh.owner_player_id = $2
                OR sh.owner_clan_id = (SELECT clan_id FROM players WHERE id = $2))`,
        [shipId, playerId],
    );
    const row = res.rows[0];
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
         LEFT JOIN universe_ship_types cur_st ON cur_st.universe_id = cur.universe_id AND cur_st.slug = cur.ship_type_slug
         WHERE tgt.id = $2
           AND (tgt.owner_player_id = $1
                OR tgt.owner_clan_id = (SELECT clan_id FROM players WHERE id = $1))`,
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
    const player = players[playerId];
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

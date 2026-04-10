import { WebSocket } from 'ws';
import { ServerMsgType } from '@twnr/shared';
import {
    players,
    sendEnvelope,
    broadcastTo,
    getGraph,
    getWarpRefs,
    getPlayerUniverseId,
    buildSectorDisplayData,
    setPlayerMenu,
    resolveSectorId,
} from '../game-state.js';
import { pool } from '../db/index.js';
import { getShipId, setDocked, moveToSector, markSectorVisited } from '../db/queries/player.js';
import { getTurnsPerWarp, getShipDrones, moveShipToSector } from '../db/queries/ship.js';
import { getSectorDbId } from '../db/queries/sector.js';
import { checkAndDeductTurns } from '../turn-logic.js';

export async function handleMove(playerId: number, targetSector: number): Promise<void> {
    if (!Number.isInteger(targetSector) || targetSector <= 0) {
        sendEnvelope(playerId, {
            type: ServerMsgType.MoveResult,
            outcome: 'error',
            message: 'Invalid sector',
        });
        return;
    }

    const shipId = await getShipId(playerId);
    if (!shipId) {
        sendEnvelope(playerId, { type: ServerMsgType.MoveResult, outcome: 'noShip' });
        return;
    }

    const player = players[playerId];
    if (!player) return;

    // Block movement during pending drone encounter
    if (player.pendingEncounter) {
        sendEnvelope(playerId, {
            type: ServerMsgType.MoveResult,
            outcome: 'error',
            message: 'Resolve drone encounter first',
        });
        return;
    }

    const universeId = player.universeId;
    const warps = await getGraph(universeId);
    const currentSector = player.sector;

    if (!warps[currentSector]?.includes(targetSector)) {
        sendEnvelope(playerId, {
            type: ServerMsgType.MoveResult,
            outcome: 'nonAdjacent',
            sector: targetSector,
        });
        return;
    }

    // Check turns
    const turnsPerWarp = await getTurnsPerWarp(playerId);
    const turnResult = await checkAndDeductTurns(playerId, universeId, turnsPerWarp);
    if (!turnResult.allowed) {
        sendEnvelope(playerId, {
            type: ServerMsgType.MoveResult,
            outcome: 'error',
            message: 'Insufficient turns',
        });
        return;
    }

    // Undock if docked
    if (player.docked) {
        player.docked = false;
        await setDocked(playerId, false);
    }

    const targetSectorId = await resolveSectorId(targetSector, universeId);
    player.sector = targetSector;
    player.sectorId = targetSectorId;
    await Promise.all([
        moveToSector(playerId, targetSectorId),
        moveShipToSector(playerId, targetSectorId),
        markSectorVisited(playerId, targetSectorId),
    ]);

    const oldSectorClients = new Set<WebSocket>();
    const newSectorClients = new Set<WebSocket>();
    for (const [idStr, p] of Object.entries(players)) {
        if (Number(idStr) === playerId) continue;
        if (p.universeId !== universeId) continue;
        if (p.docked) continue;
        if (p.sector === currentSector) oldSectorClients.add(p.ws);
        else if (p.sector === targetSector) newSectorClients.add(p.ws);
    }
    broadcastTo(
        { type: ServerMsgType.PlayerMoved, playerId, sector: targetSector, direction: 'out' },
        oldSectorClients,
    );
    broadcastTo(
        { type: ServerMsgType.PlayerMoved, playerId, sector: targetSector, direction: 'in' },
        newSectorClients,
    );

    const sectorData = await buildSectorDisplayData(playerId, targetSector);
    if (!sectorData) return;

    // Hostile drone encounter — send DroneEncounter with embedded sector data
    if (sectorData.sectorDrones && sectorData.sectorDrones.ownerId !== playerId) {
        player.pendingEncounter = { retreatSector: currentSector };
        await setPlayerMenu(playerId, 'droneEncounter');

        const shipDrones = (await getShipDrones(playerId)) ?? 0;

        sendEnvelope(playerId, {
            type: ServerMsgType.MoveResult,
            outcome: 'encounter',
            sector: targetSector,
            warps: sectorData.warps,
            players: sectorData.players,
            port: sectorData.port,
            sectorDrones: sectorData.sectorDrones.quantity,
            ownerId: sectorData.sectorDrones.ownerId,
            ownerName: sectorData.sectorDrones.ownerName,
            shipDrones,
            retreatSector: currentSector,
            turnsUsed: turnResult.turnsUsed,
        });

        // Alert the owner about the intrusion (skip for rogue drones)
        const ownerId = sectorData.sectorDrones.ownerId;
        const owner = ownerId != null ? players[ownerId] : undefined;
        if (owner && owner.ws.readyState === 1 && ownerId != null) {
            sendEnvelope(ownerId, {
                type: ServerMsgType.SectorDronesAlert,
                event: 'intrusion',
                sector: targetSector,
                dronesLost: 0,
                dronesRemaining: sectorData.sectorDrones.quantity,
                intruderName: player.name,
            });
        }
        return;
    }

    await setPlayerMenu(playerId, 'sector');
    sendEnvelope(playerId, {
        type: ServerMsgType.MoveResult,
        outcome: 'success',
        ...sectorData,
        turnsUsed: turnResult.turnsUsed,
    });
}

export async function handleSectorDisplay(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const data = await buildSectorDisplayData(playerId);
    if (!data) return;
    sendEnvelope(playerId, { type: ServerMsgType.SectorDisplayResult, ...data });
}

export async function handleWarpsOut(playerId: number, id: number): Promise<void> {
    if (!Number.isInteger(id) || id <= 0) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Invalid sector ID' });
        return;
    }

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    const sectorDbId = await getSectorDbId(id, universeId);
    if (!sectorDbId) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Sector not found' });
        return;
    }

    const warpRefs = await getWarpRefs(playerId, id, universeId);
    sendEnvelope(playerId, { type: ServerMsgType.WarpsOutResult, id, warps: warpRefs });
}

export async function handleShortestPath(
    playerId: number,
    from: number,
    to: number,
): Promise<void> {
    if (!Number.isInteger(from) || from <= 0 || !Number.isInteger(to) || to <= 0) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Invalid sector ID' });
        return;
    }

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    const sectorRes = await pool.query(
        'SELECT sector_number FROM sectors WHERE sector_number IN ($1, $2) AND universe_id = $3',
        [from, to, universeId],
    );
    if (sectorRes.rows.length !== (from === to ? 1 : 2)) {
        const foundIds = new Set(sectorRes.rows.map((r: any) => r.sector_number));
        if (!foundIds.has(from) || !foundIds.has(to)) {
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Sector not found' });
            return;
        }
    }

    if (from === to) {
        sendEnvelope(playerId, {
            type: ServerMsgType.ShortestPathResult,
            path: [{ sector: from, visited: true }],
            hops: 0,
        });
        return;
    }

    const warps = await getGraph(universeId);
    const queue: { sector: number; path: number[] }[] = [{ sector: from, path: [from] }];
    const visited = new Set<number>();
    visited.add(from);

    while (queue.length > 0) {
        const { sector, path } = queue.shift()!;
        const neighbors = warps[sector] || [];
        for (const neighbor of neighbors) {
            if (neighbor === to) {
                const finalPath = [...path, neighbor];
                const visitedRes = await pool.query(
                    `SELECT s.sector_number FROM visited_sectors vs
                     JOIN sectors s ON vs.sector_id = s.id
                     WHERE vs.player_id = $1 AND s.universe_id = $2
                       AND s.sector_number = ANY($3::int[])`,
                    [playerId, universeId, finalPath],
                );
                const visitedSet = new Set(visitedRes.rows.map((r: any) => r.sector_number));
                await setPlayerMenu(playerId, 'autopilotPrompt');
                sendEnvelope(playerId, {
                    type: ServerMsgType.ShortestPathResult,
                    path: finalPath.map((s) => ({ sector: s, visited: visitedSet.has(s) })),
                    hops: finalPath.length - 1,
                });
                return;
            }
            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push({ sector: neighbor, path: [...path, neighbor] });
            }
        }
    }

    sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'No path found' });
}

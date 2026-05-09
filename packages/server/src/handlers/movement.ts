import { WebSocket } from 'ws';
import { ServerMsgType } from '@twnr/shared';
import { players, getPlayerUniverseId } from '../state/players.js';
import { sendEnvelope, sendError, broadcastTo, closeDestroyedSession } from '../state/messaging.js';
import { getGraph } from '../state/graph-cache.js';
import { getWarpRefs, resolveSectorId } from '../services/sector-lookup.js';
import { buildSectorDisplayData } from '../services/sector-display.js';
import { isInEncounter } from '../services/encounter.js';
import {
    setDocked,
    moveToSector,
    markSectorVisited,
    getPreviousSectorNumber,
} from '../db/queries/player.js';
import { getShipDrones, getShipTurnsPerWarp, moveShipToSector } from '../db/queries/ship.js';
import {
    getSectorDbId,
    findSectorsByNumbers,
    findVisitedSectorsInSet,
} from '../db/queries/sector.js';
import { deductTurns, fetchMoveTurnContext } from '../turn-logic.js';
import { resolveMinesOnEntry } from '../services/mine-encounter.js';

export async function handleMove(playerId: number, targetSector: number): Promise<void> {
    if (!Number.isInteger(targetSector) || targetSector <= 0) {
        sendEnvelope(playerId, {
            type: ServerMsgType.MoveResult,
            outcome: 'error',
            message: 'Invalid sector',
        });
        return;
    }

    const player = players[playerId];
    if (!player) return;

    // Block movement during pending drone encounter (derived: enemy drones in current sector)
    if (await isInEncounter(playerId)) {
        sendEnvelope(playerId, {
            type: ServerMsgType.MoveResult,
            outcome: 'error',
            message: 'Resolve drone encounter first',
        });
        return;
    }

    const universeId = player.universeId;
    const [ctx, warps] = await Promise.all([
        fetchMoveTurnContext(playerId, universeId),
        getGraph(universeId),
    ]);

    if (!ctx || !ctx.shipId) {
        sendEnvelope(playerId, { type: ServerMsgType.MoveResult, outcome: 'noShip' });
        return;
    }

    const currentSector = player.sector;
    if (!warps[currentSector]?.includes(targetSector)) {
        sendEnvelope(playerId, {
            type: ServerMsgType.MoveResult,
            outcome: 'nonAdjacent',
            sector: targetSector,
        });
        return;
    }

    const turnResult = await deductTurns(playerId, ctx.turnsPerWarp, ctx);
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
        {
            type: ServerMsgType.PlayerMoved,
            playerId,
            playerName: player.name,
            sector: targetSector,
            direction: 'out',
        },
        oldSectorClients,
    );
    broadcastTo(
        {
            type: ServerMsgType.PlayerMoved,
            playerId,
            playerName: player.name,
            sector: targetSector,
            direction: 'in',
        },
        newSectorClients,
    );

    // Resolve any enemy mines in the destination sector. Proximity mines may
    // damage or destroy the ship before the player can do anything; seeker
    // mines may attach silently. Run before drone-encounter check so a kill
    // shortcuts further work.
    const mineOutcome = await resolveMinesOnEntry(playerId);
    if (mineOutcome.destroyed) {
        await sendEnvelope(playerId, {
            type: ServerMsgType.MoveResult,
            outcome: 'destroyed',
            reason: 'Destroyed by proximity mine',
        });
        closeDestroyedSession(playerId, 'Ship destroyed');
        return;
    }

    const sectorData = await buildSectorDisplayData(playerId, targetSector);
    if (!sectorData) return;

    if (sectorData.sectorDrones && sectorData.sectorDrones.ownerId !== playerId) {
        // Encounter is derived from sector state — no in-memory flag.
        // retreatSector below comes from previous_sector_id (set by moveToSector above).
        const shipDrones = (await getShipDrones(playerId)) ?? 0;

        // Server stays in sector location; the encounter UI is a client
        // sub-mode entered by the client's moveResult handler when
        // outcome === 'encounter'.
        await sendEnvelope(playerId, {
            type: ServerMsgType.MoveResult,
            outcome: 'encounter',
            ...sectorData,
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

    await sendEnvelope(
        playerId,
        {
            type: ServerMsgType.MoveResult,
            outcome: 'success',
            ...sectorData,
            turnsUsed: turnResult.turnsUsed,
        },
        'sector',
    );
}

export async function handleMoveToPrevious(playerId: number): Promise<void> {
    const prev = await getPreviousSectorNumber(playerId);
    sendEnvelope(playerId, { type: ServerMsgType.PreviousSectorResult, sector: prev });
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
        sendError(playerId, 'Invalid sector ID');
        return;
    }

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    const sectorDbId = await getSectorDbId(id, universeId);
    if (!sectorDbId) {
        sendError(playerId, 'Sector not found');
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
        sendError(playerId, 'Invalid sector ID');
        return;
    }

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    const foundSectors = await findSectorsByNumbers([from, to], universeId);
    if (!foundSectors.has(from) || !foundSectors.has(to)) {
        sendError(playerId, 'Sector not found');
        return;
    }

    if (from === to) {
        sendEnvelope(playerId, {
            type: ServerMsgType.ShortestPathResult,
            path: [{ sector: from, visited: true }],
            hops: 0,
            turns: 0,
        });
        return;
    }

    const turnsPerWarp = await getShipTurnsPerWarp(playerId);

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
                const visitedSet = await findVisitedSectorsInSet(playerId, universeId, finalPath);
                const hops = finalPath.length - 1;
                await sendEnvelope(playerId, {
                    type: ServerMsgType.ShortestPathResult,
                    path: finalPath.map((s) => ({ sector: s, visited: visitedSet.has(s) })),
                    hops,
                    turns: hops * turnsPerWarp,
                });
                return;
            }
            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push({ sector: neighbor, path: [...path, neighbor] });
            }
        }
    }

    sendError(playerId, 'No path found');
}

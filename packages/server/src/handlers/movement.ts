import { ServerTag } from '@twnr/shared';
import type { MoveCommand, WarpsOutCommand, ShortestPathCommand } from '@twnr/shared';
import { onlinePlayers, getPlayerUniverseId } from '../state/players.js';
import { sendEnvelope, sendError, closeDestroyedSession } from '../state/messaging.js';
import { broadcastPlayerMoved } from '../services/sector-activity.js';
import { getGraph } from '../state/graph-cache.js';
import { getWarpRefs, resolveSectorId } from '../services/sector-lookup.js';
import { buildSectorDisplayData } from '../services/sector-display.js';
import { isInEncounter } from '../services/encounter.js';
import { notifyTurnChange } from '../services/notify.js';
import { refreshSectorObservation } from '../services/sector-observations.js';
import { moveToSector, markSectorVisited, getPreviousSectorNumber } from '../db/queries/player.js';
import { getShipDrones, getShipTurnsPerWarp, moveShipToSector } from '../db/queries/ship.js';
import {
    getSectorDbId,
    findSectorsByNumbers,
    findVisitedSectorsInSet,
} from '../db/queries/sector.js';
import { deductTurns, fetchMoveTurnContext } from '../turn-logic.js';
import { resolveMinesOnEntry } from '../services/mine-encounter.js';
import {
    getTowState,
    moveTowedShip,
    getTowingPlayerForShip,
    clearTowedShip,
} from '../db/queries/tow.js';
import { combinedTurnsPerWarp } from './tow.js';
import type { TowedAlong } from '@twnr/shared';

export async function serveMove(playerId: number, data: MoveCommand): Promise<void> {
    const targetSector = data.sector;
    if (!Number.isInteger(targetSector) || targetSector <= 0) {
        sendEnvelope(playerId, {
            type: ServerTag.MoveResult,
            outcome: 'error',
            message: 'Invalid sector',
        });
        return;
    }

    const player = onlinePlayers[playerId];
    if (!player) return;

    if (await isInEncounter(playerId)) {
        sendEnvelope(playerId, {
            type: ServerTag.MoveResult,
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
        sendEnvelope(playerId, { type: ServerTag.MoveResult, outcome: 'noShip' });
        return;
    }

    const towerId = await getTowingPlayerForShip(ctx.shipId);
    const freedFromTow = towerId !== null && towerId !== playerId;

    if (player.docked || player.at_starbase) {
        sendEnvelope(playerId, {
            type: ServerTag.MoveResult,
            outcome: 'error',
            message: 'You must undock before warping',
        });
        return;
    }

    const currentSector = player.sector;
    if (!warps[currentSector]?.includes(targetSector)) {
        sendEnvelope(playerId, {
            type: ServerTag.MoveResult,
            outcome: 'nonAdjacent',
            sector: targetSector,
        });
        return;
    }

    const towState = await getTowState(playerId);
    const effectiveTpw = towState
        ? combinedTurnsPerWarp(ctx.turnsPerWarp, towState.towed_ship_turns_per_warp)
        : ctx.turnsPerWarp;
    const turnResult = await deductTurns(playerId, effectiveTpw, ctx);
    if (!turnResult.allowed) {
        sendEnvelope(playerId, {
            type: ServerTag.MoveResult,
            outcome: 'error',
            message: 'Insufficient turns',
        });
        return;
    }

    const targetSectorId = await resolveSectorId(targetSector, universeId);
    player.sector = targetSector;
    player.sectorId = targetSectorId;
    await Promise.all([
        moveToSector(playerId, targetSectorId),
        moveShipToSector(playerId, targetSectorId),
        markSectorVisited(playerId, targetSectorId),
    ]);

    let towedAlong: TowedAlong | undefined;
    if (towState) {
        await moveTowedShip(towState.towed_ship_id, targetSectorId);
        if (towState.towed_owner_player_id !== null) {
            const owner = onlinePlayers[towState.towed_owner_player_id];
            if (owner) {
                owner.sector = targetSector;
                owner.sectorId = targetSectorId;
            }
        }
        towedAlong =
            towState.towed_owner_player_id !== null
                ? {
                      kind: 'manned',
                      name: towState.towed_owner_player_name ?? '',
                      shipTypeDisplayName: towState.towed_ship_type_display_name,
                      shipTypeName: towState.towed_ship_name,
                  }
                : {
                      kind: 'unmanned',
                      name: towState.towed_ship_name,
                      shipTypeDisplayName: towState.towed_ship_type_display_name,
                      shipTypeName: towState.towed_ship_name,
                  };
        if (towState.towed_owner_player_id !== null) {
            const { notifyAndMail } = await import('../services/notify.js');
            await notifyAndMail({
                recipientId: towState.towed_owner_player_id,
                sender: { kind: 'player', playerId, displayName: player.name },
                kind: 'tow',
                body: `I towed you from sector ${currentSector} to sector ${targetSector}.`,
            });
        }
    }

    broadcastPlayerMoved(playerId, currentSector, targetSector, towedAlong);

    if (freedFromTow && towerId !== null) {
        await clearTowedShip(towerId);
        const towerOnline = onlinePlayers[towerId];
        if (towerOnline) {
            sendEnvelope(towerId, {
                type: ServerTag.TowReleasedAlert,
                towedName: player.name,
            });
        }
    }

    const mineOutcome = await resolveMinesOnEntry(playerId);
    await refreshSectorObservation(playerId, targetSectorId);
    if (mineOutcome.destroyed) {
        await sendEnvelope(playerId, {
            type: ServerTag.MoveResult,
            outcome: 'destroyed',
            reason: 'Destroyed by proximity mine',
        });
        closeDestroyedSession(playerId, 'Ship destroyed');
        return;
    }

    const sectorData = await buildSectorDisplayData(playerId, targetSector);
    if (!sectorData) return;

    if (sectorData.sectorDrones && sectorData.sectorDrones.ownerId !== playerId) {
        const shipDrones = (await getShipDrones(playerId)) ?? 0;
        const ownership = sectorData.sectorDrones.ownership;
        const ownerName =
            ownership.kind === 'player'
                ? ownership.name
                : ownership.kind === 'clan'
                  ? `#${ownership.clanNumber} ${ownership.name}`
                  : 'Rogue';

        if (turnResult.turnsUsed) {
            notifyTurnChange(playerId, turnResult.turnsUsed, 'warping');
        }
        await sendEnvelope(playerId, {
            type: ServerTag.MoveResult,
            outcome: 'encounter',
            ...sectorData,
            ownerId: sectorData.sectorDrones.ownerId,
            ownerName,
            shipDrones,
            retreatSector: currentSector,
            turnsUsed: turnResult.turnsUsed,
            towedAlong,
            ...(freedFromTow ? ({ freedFromTow: true } as const) : {}),
        });

        const ownerId = sectorData.sectorDrones.ownerId;
        if (ownerId != null) {
            const owner = onlinePlayers[ownerId];
            if (owner && owner.ws.readyState === 1) {
                sendEnvelope(ownerId, {
                    type: ServerTag.SectorDronesAlert,
                    event: 'intrusion',
                    sector: targetSector,
                    dronesLost: 0,
                    dronesRemaining: sectorData.sectorDrones.quantity,
                    intruderName: player.name,
                });
            }
            const { insertSystemMemo } = await import('../db/queries/message.js');
            await insertSystemMemo(
                ownerId,
                'Deployed Drones',
                'drones_intrusion',
                `Report Sector ${targetSector}: ${player.name} entered sector.`,
            );
        }
        return;
    }

    if (turnResult.turnsUsed) {
        notifyTurnChange(playerId, turnResult.turnsUsed, 'warping');
    }
    await sendEnvelope(playerId, {
        type: ServerTag.MoveResult,
        outcome: 'success',
        ...sectorData,
        turnsUsed: turnResult.turnsUsed,
        towedAlong,
        ...(freedFromTow ? ({ freedFromTow: true } as const) : {}),
    });
}

export async function serveMoveToPrevious(playerId: number): Promise<void> {
    const prev = await getPreviousSectorNumber(playerId);
    sendEnvelope(playerId, { type: ServerTag.PreviousSectorResult, sector: prev });
}

export async function serveSectorDisplay(playerId: number): Promise<void> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    const data = await buildSectorDisplayData(playerId);
    if (!data) return;
    sendEnvelope(playerId, { type: ServerTag.SectorDisplayResult, ...data });
}

export async function serveWarpsOut(playerId: number, data: WarpsOutCommand): Promise<void> {
    const { id } = data;
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
    sendEnvelope(playerId, { type: ServerTag.WarpsOutResult, id, warps: warpRefs });
}

export async function serveShortestPath(
    playerId: number,
    data: ShortestPathCommand,
): Promise<void> {
    const { from, to } = data;
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
            type: ServerTag.ShortestPathResult,
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
                    type: ServerTag.ShortestPathResult,
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

import { Events } from '@twnr/shared';
import type { CommandRequest } from '@twnr/shared';
import { onlinePlayers, requireOnlinePlayer } from '../state/players.js';
import { sendEnvelope, closeDestroyedSession } from '../state/messaging.js';
import { broadcastPlayerMoved } from '../services/sector-activity.js';
import { getGraph } from '../state/graph-cache.js';
import { getWarpRefs, resolveSectorId } from '../services/sector-lookup.js';
import { buildSectorDisplayData } from '../services/sector-display.js';
import { isInEncounter, enterEncounter } from '../services/encounter.js';
import { notifyTurnChange } from '../services/notify.js';
import { refreshSectorObservation } from '../services/sector-observations.js';
import { moveToSector, markSectorVisited, getPreviousSectorNumber } from '../db/queries/player.js';
import { hasEnemyDronesInSector } from '../db/queries/drones.js';
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
import { type CommandResult, commandRefusal } from './command.js';

export async function serveMove(
    playerId: number,
    data: CommandRequest<'Move'>,
): Promise<CommandResult<'Move'>> {
    const targetSector = data.sector;
    if (!Number.isInteger(targetSector) || targetSector <= 0) {
        return commandRefusal('noSuchSector');
    }

    const player = requireOnlinePlayer(playerId);

    if (isInEncounter(playerId)) {
        return commandRefusal('inEncounter');
    }

    const universeId = player.universeId;
    const [ctx, warps] = await Promise.all([
        fetchMoveTurnContext(playerId, universeId),
        getGraph(universeId),
    ]);

    if (!ctx || !ctx.shipId) {
        return { outcome: 'noShip' };
    }

    const towerId = await getTowingPlayerForShip(ctx.shipId);
    const freedFromTow = towerId !== null && towerId !== playerId;

    if (player.docked || player.at_starbase) {
        return commandRefusal('docked');
    }

    const currentSector = player.sector;
    if (!warps[currentSector]?.includes(targetSector)) {
        return {
            outcome: 'nonAdjacent',
            sector: targetSector,
        };
    }

    const towState = await getTowState(playerId);
    const effectiveTpw = towState
        ? combinedTurnsPerWarp(ctx.turnsPerWarp, towState.towed_ship_turns_per_warp)
        : ctx.turnsPerWarp;
    const turnResult = await deductTurns(playerId, effectiveTpw, ctx);
    if (!turnResult.allowed) {
        return commandRefusal('insufficientTurns');
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

    void broadcastPlayerMoved(playerId, currentSector, targetSector, towedAlong);

    if (freedFromTow && towerId !== null) {
        await clearTowedShip(towerId);
        const towerOnline = onlinePlayers[towerId];
        if (towerOnline) {
            sendEnvelope(towerId, {
                type: Events.TowReleased.name,
                towedName: player.name,
            });
        }
    }

    const mineOutcome = await resolveMinesOnEntry(playerId);
    await refreshSectorObservation(playerId, targetSectorId);
    if (mineOutcome.destroyed) {
        closeDestroyedSession(playerId, 'Ship destroyed');
        return { outcome: 'destroyed', reason: 'Destroyed by proximity mine' };
    }

    const sectorData = await buildSectorDisplayData(playerId, targetSector);

    const facingHostileDrones =
        sectorData.sectorDrones != null &&
        (await hasEnemyDronesInSector(targetSector, universeId, playerId));
    if (facingHostileDrones && sectorData.sectorDrones) {
        enterEncounter(playerId);
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

        const ownerId = sectorData.sectorDrones.ownerId;
        if (ownerId != null) {
            const owner = onlinePlayers[ownerId];
            if (owner && owner.ws.readyState === 1) {
                sendEnvelope(ownerId, {
                    type: Events.SectorDronesReported.name,
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
        return {
            outcome: 'encounter',
            ...sectorData,
            ownerId: sectorData.sectorDrones.ownerId,
            ownerName,
            shipDrones,
            retreatSector: currentSector,
            turnsUsed: turnResult.turnsUsed,
            towedAlong,
            ...(freedFromTow ? ({ freedFromTow: true } as const) : {}),
        };
    }

    if (turnResult.turnsUsed) {
        notifyTurnChange(playerId, turnResult.turnsUsed, 'warping');
    }
    return {
        outcome: 'success',
        ...sectorData,
        turnsUsed: turnResult.turnsUsed,
        towedAlong,
        ...(freedFromTow ? ({ freedFromTow: true } as const) : {}),
    };
}

export async function serveMoveToPrevious(
    playerId: number,
): Promise<CommandResult<'MoveToPrevious'>> {
    const prev = await getPreviousSectorNumber(playerId);
    return { outcome: 'ok', sector: prev };
}

export async function serveSectorDisplay(
    playerId: number,
): Promise<CommandResult<'SectorDisplay'>> {
    requireOnlinePlayer(playerId);

    const data = await buildSectorDisplayData(playerId);
    return { outcome: 'ok', ...data };
}

export async function serveWarpsOut(
    playerId: number,
    data: CommandRequest<'WarpsOut'>,
): Promise<CommandResult<'WarpsOut'>> {
    const { id } = data;

    const { universeId } = requireOnlinePlayer(playerId);

    const sectorDbId = await getSectorDbId(id, universeId);
    if (!sectorDbId) {
        return commandRefusal('noSuchSector');
    }

    const warpRefs = await getWarpRefs(playerId, id, universeId);
    return { outcome: 'ok', id, warps: warpRefs };
}

export async function serveShortestPath(
    playerId: number,
    data: CommandRequest<'ShortestPath'>,
): Promise<CommandResult<'ShortestPath'>> {
    const { from, to } = data;

    const { universeId } = requireOnlinePlayer(playerId);

    const foundSectors = await findSectorsByNumbers([from, to], universeId);
    if (!foundSectors.has(from) || !foundSectors.has(to)) {
        return commandRefusal('noSuchSector');
    }

    if (from === to) {
        return { outcome: 'ok', path: [{ sector: from, visited: true }], hops: 0, turns: 0 };
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
                return {
                    outcome: 'ok',
                    path: finalPath.map((s) => ({ sector: s, visited: visitedSet.has(s) })),
                    hops,
                    turns: hops * turnsPerWarp,
                };
            }
            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push({ sector: neighbor, path: [...path, neighbor] });
            }
        }
    }

    return commandRefusal('noPath');
}

import { ServerTag } from '@twnr/shared';
import type { HyperspaceJumpCommand } from '@twnr/shared';
import { players } from '../state/players.js';
import { sendEnvelope, sendError } from '../state/messaging.js';
import { getGraph } from '../state/graph-cache.js';
import { resolveSectorId } from '../services/sector-lookup.js';
import { getOnPlanetId, moveToSector, markSectorVisited } from '../db/queries/player.js';
import {
    getShipFuel,
    getShipHyperspaceInfo,
    deductShipFuelAndMoveShip,
} from '../db/queries/ship.js';
import { getDeployedDronesByOwnerBySector } from '../db/queries/drones.js';
import { checkAndDeductTurns } from '../turn-logic.js';
import { resolveMinesOnEntry } from '../services/mine-encounter.js';

export async function handleHyperspaceJump(
    playerId: number,
    data: HyperspaceJumpCommand,
): Promise<void> {
    const { targetSector } = data;
    const player = players[playerId];
    if (!player) return;

    if (player.docked || player.at_starbase) {
        sendError(playerId, 'Cannot use this command while docked');
        return;
    }

    const onPlanetId = await getOnPlanetId(playerId);
    if (onPlanetId) {
        sendError(playerId, 'Cannot use this command while on a planet');
        return;
    }

    const shipRow = await getShipHyperspaceInfo(playerId);
    if (!shipRow) {
        sendError(playerId, 'Ship not found');
        return;
    }
    if (!shipRow.has_hyperspace_1 && !shipRow.has_hyperspace_2) {
        sendError(playerId, 'Hyperspace drive not equipped');
        return;
    }

    const universeId = player.universeId;

    // Check drones in target sector
    const targetDrones = await getDeployedDronesByOwnerBySector(targetSector, playerId);
    if (targetDrones === 0) {
        sendError(playerId, 'No signal from drones in target sector');
        return;
    }

    // BFS shortest path
    const warps = await getGraph(universeId);
    const currentSector = player.sector;

    if (currentSector === targetSector) {
        sendEnvelope(playerId, {
            type: ServerTag.HyperspaceJumpResult,
            targetSector,
            fuelUsed: 0,
            turnsUsed: 0,
        });
        return;
    }

    const queue: { sector: number; hops: number }[] = [{ sector: currentSector, hops: 0 }];
    const visited = new Set<number>();
    visited.add(currentSector);
    let pathHops = -1;

    while (queue.length > 0) {
        const { sector, hops } = queue.shift()!;
        const neighbors = warps[sector] || [];
        for (const neighbor of neighbors) {
            if (neighbor === targetSector) {
                pathHops = hops + 1;
                break;
            }
            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push({ sector: neighbor, hops: hops + 1 });
            }
        }
        if (pathHops >= 0) break;
    }

    if (pathHops < 0) {
        sendError(playerId, 'No path to target sector');
        return;
    }

    const fuelCost = pathHops * 3;

    const shipFuel = await getShipFuel(playerId);
    if (shipFuel === undefined || shipFuel < fuelCost) {
        sendError(playerId, 'Insufficient fuel for hyperspace jump');
        return;
    }

    const turnResult = await checkAndDeductTurns(playerId, universeId, shipRow.turns_per_warp);
    if (!turnResult.allowed) {
        sendError(playerId, 'Insufficient turns');
        return;
    }

    const targetSectorId = await resolveSectorId(targetSector, universeId);
    await deductShipFuelAndMoveShip(shipRow.ship_id, fuelCost, targetSectorId);
    player.sector = targetSector;
    player.sectorId = targetSectorId;
    await Promise.all([
        moveToSector(playerId, targetSectorId),
        markSectorVisited(playerId, targetSectorId),
    ]);

    sendEnvelope(playerId, {
        type: ServerTag.HyperspaceJumpResult,
        targetSector,
        fuelUsed: fuelCost,
        turnsUsed: turnResult.turnsUsed,
    });

    await resolveMinesOnEntry(playerId);
}

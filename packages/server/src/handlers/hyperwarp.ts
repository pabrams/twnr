import type { CommandRequest } from '@twnr/shared';
import { onlinePlayers } from '../state/players.js';
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
import { notifyTurnChange } from '../services/notify.js';
import { broadcastPlayerMoved } from '../services/sector-activity.js';
import { resolveMinesOnEntry } from '../services/mine-encounter.js';
import { type CommandResult, commandRefusal } from './command.js';

export async function serveHyperspaceJump(
    playerId: number,
    data: CommandRequest<'HyperspaceJump'>,
): Promise<CommandResult<'HyperspaceJump'>> {
    const { targetSector } = data;
    const player = onlinePlayers[playerId];
    if (!player) return;

    if (player.docked || player.at_starbase) {
        return commandRefusal('docked');
    }

    const onPlanetId = await getOnPlanetId(playerId);
    if (onPlanetId) {
        return commandRefusal('onPlanet');
    }

    const shipRow = await getShipHyperspaceInfo(playerId);
    if (!shipRow) {
        return commandRefusal('noShip');
    }
    if (!shipRow.has_hyperspace_1 && !shipRow.has_hyperspace_2) {
        return commandRefusal('noHyperspaceDrive');
    }

    const universeId = player.universeId;

    const targetDrones = await getDeployedDronesByOwnerBySector(targetSector, playerId);
    if (targetDrones === 0) {
        return commandRefusal('noDroneSignal');
    }

    const warps = await getGraph(universeId);
    const currentSector = player.sector;

    if (currentSector === targetSector) {
        return {
            targetSector,
            fuelUsed: 0,
            turnsUsed: 0,
        };
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
        return commandRefusal('noPath');
    }

    const fuelCost = pathHops * 3;

    const shipFuel = await getShipFuel(playerId);
    if (shipFuel === undefined || shipFuel < fuelCost) {
        return commandRefusal('insufficientFuel');
    }

    const turnResult = await checkAndDeductTurns(playerId, universeId, shipRow.turns_per_warp);
    if (!turnResult.allowed) {
        return commandRefusal('insufficientTurns');
    }

    const targetSectorId = await resolveSectorId(targetSector, universeId);
    await deductShipFuelAndMoveShip(shipRow.ship_id, fuelCost, targetSectorId);
    player.sector = targetSector;
    player.sectorId = targetSectorId;
    await Promise.all([
        moveToSector(playerId, targetSectorId),
        markSectorVisited(playerId, targetSectorId),
    ]);

    void broadcastPlayerMoved(playerId, currentSector, targetSector);

    if (turnResult.turnsUsed) {
        notifyTurnChange(playerId, turnResult.turnsUsed, 'hyperspace jump');
    }
    await resolveMinesOnEntry(playerId);
    return {
        targetSector,
        fuelUsed: fuelCost,
        turnsUsed: turnResult.turnsUsed,
    };
}

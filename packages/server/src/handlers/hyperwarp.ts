import { ServerMsgType } from '@twnr/shared';
import { players, sendEnvelope, getGraph, resolveSectorId } from '../game-state.js';
import { pool } from '../db/index.js';
import { getOnPlanetId, moveToSector, markSectorVisited } from '../db/queries/player.js';
import { getShipFuel } from '../db/queries/ship.js';
import { checkAndDeductTurns } from '../turn-logic.js';

export async function handleListDeployedDrones(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (player.docked || player.at_starbase) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'Cannot use this command while docked',
        });
        return;
    }
    const onPlanetId = await getOnPlanetId(playerId);
    if (onPlanetId) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'Cannot use this command while on a planet',
        });
        return;
    }

    const res = await pool.query(
        `SELECT s.sector_number as sector_id, sf.quantity
         FROM sector_drones sf
         JOIN sectors s ON sf.sector_id = s.id
         WHERE sf.owner_id = $1 AND sf.quantity > 0`,
        [playerId],
    );

    sendEnvelope(playerId, {
        type: ServerMsgType.ListDeployedDronesResult,
        drones: res.rows.map((r: any) => ({ sectorId: r.sector_id, quantity: r.quantity })),
    });
}

export async function handleHyperspaceJump(playerId: number, targetSector: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (player.docked || player.at_starbase) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'Cannot use this command while docked',
        });
        return;
    }

    const onPlanetId = await getOnPlanetId(playerId);
    if (onPlanetId) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'Cannot use this command while on a planet',
        });
        return;
    }

    // Check has hyperspace drive (type 1 or 2)
    const shipRes = await pool.query(
        `SELECT s.id as ship_id, s.has_hyperspace_1, s.has_hyperspace_2, s.turns_per_warp
         FROM ships s JOIN players p ON p.ship_id = s.id
         WHERE p.id = $1`,
        [playerId],
    );
    if (shipRes.rows.length === 0) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Ship not found' });
        return;
    }
    if (!shipRes.rows[0].has_hyperspace_1 && !shipRes.rows[0].has_hyperspace_2) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'Hyperspace drive not equipped',
        });
        return;
    }

    const universeId = player.universeId;

    // Check drones in target sector
    const droneRes = await pool.query(
        `SELECT sf.quantity FROM sector_drones sf
         JOIN sectors s ON sf.sector_id = s.id
         WHERE s.sector_number = $1 AND s.universe_id = $2 AND sf.owner_id = $3 AND sf.quantity > 0`,
        [targetSector, universeId, playerId],
    );
    if (droneRes.rows.length === 0) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'No signal from drones in target sector',
        });
        return;
    }

    // BFS shortest path
    const warps = await getGraph(universeId);
    const currentSector = player.sector;

    if (currentSector === targetSector) {
        sendEnvelope(playerId, {
            type: ServerMsgType.HyperspaceJumpResult,
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
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'No path to target sector' });
        return;
    }

    const fuelCost = pathHops * 3;

    // Check fuel
    const shipFuel = await getShipFuel(playerId);
    if (shipFuel === undefined || shipFuel < fuelCost) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'Insufficient fuel for hyperspace jump',
        });
        return;
    }

    // Check turns
    const turnsPerWarp = shipRes.rows[0].turns_per_warp;
    const turnResult = await checkAndDeductTurns(playerId, universeId, turnsPerWarp);
    if (!turnResult.allowed) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Insufficient turns' });
        return;
    }

    // Deduct fuel and move
    const targetSectorId = await resolveSectorId(targetSector, universeId);
    await pool.query('UPDATE ships SET fuel = fuel - $1, sector_id = $2 WHERE id = $3', [
        fuelCost,
        targetSectorId,
        shipRes.rows[0].ship_id,
    ]);
    player.sector = targetSector;
    player.sectorId = targetSectorId;
    await Promise.all([
        moveToSector(playerId, targetSectorId),
        markSectorVisited(playerId, targetSectorId),
    ]);

    sendEnvelope(playerId, {
        type: ServerMsgType.HyperspaceJumpResult,
        targetSector,
        fuelUsed: fuelCost,
        turnsUsed: turnResult.turnsUsed,
    });
}

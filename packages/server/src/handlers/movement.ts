import { WebSocket } from 'ws';
import { ServerMsgType } from '@twnr/shared';
import {
    players,
    sendEnvelope,
    broadcastTo,
    getGraph,
    getPortForSector,
    getWarpRefs,
    getPlayerUniverseId,
    getSectorDrones,
    setPlayerMenu,
    resolveSectorId,
} from '../game-state.js';
import { pool } from '../db/index.js';
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

    const shipCheck = await pool.query('SELECT ship_id FROM players WHERE id = $1', [playerId]);
    if (!shipCheck.rows[0]?.ship_id) {
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
    const turnsPerWarpRes = await pool.query(
        'SELECT s.turns_per_warp FROM ships s WHERE s.id = (SELECT ship_id FROM players WHERE id = $1)',
        [playerId],
    );
    const turnsPerWarp = turnsPerWarpRes.rows[0]?.turns_per_warp ?? 1;
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
        await pool.query('UPDATE players SET docked = FALSE WHERE id = $1', [playerId]);
    }

    const targetSectorId = await resolveSectorId(targetSector, universeId);
    player.sector = targetSector;
    player.sectorId = targetSectorId;
    await Promise.all([
        pool.query('UPDATE players SET current_sector_id = $1 WHERE id = $2', [
            targetSectorId,
            playerId,
        ]),
        pool.query(
            'UPDATE ships SET sector_id = $1 WHERE id = (SELECT ship_id FROM players WHERE id = $2)',
            [targetSectorId, playerId],
        ),
        pool.query(
            'INSERT INTO visited_sectors (player_id, sector_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [playerId, targetSectorId],
        ),
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

    const [port, warpRefs, sectorDrones, planetsRes] = await Promise.all([
        getPortForSector(targetSector, universeId),
        getWarpRefs(playerId, targetSector, universeId),
        getSectorDrones(targetSector, universeId),
        pool.query(
            `SELECT pl.id, pl.name, pl.type FROM planets pl
             JOIN sectors s ON pl.sector_id = s.id
             WHERE s.sector_number = $1 AND s.universe_id = $2 ORDER BY pl.id`,
            [targetSector, universeId],
        ),
    ]);
    const planets = planetsRes.rows;
    const playersInSector = Object.entries(players)
        .filter(
            ([id, p]) =>
                p.sector === targetSector &&
                p.universeId === universeId &&
                !p.docked &&
                Number(id) !== playerId,
        )
        .map(([id, p]) => ({ id: Number(id), name: p.name }));

    // Hostile drone encounter — send DroneEncounter with embedded sector data (Oak's design)
    if (sectorDrones && sectorDrones.ownerId !== playerId) {
        player.pendingEncounter = { retreatSector: currentSector };
        await setPlayerMenu(playerId, 'droneEncounter');

        const shipRes = await pool.query(
            'SELECT drones FROM ships WHERE id = (SELECT ship_id FROM players WHERE id = $1)',
            [playerId],
        );

        sendEnvelope(playerId, {
            type: ServerMsgType.MoveResult,
            outcome: 'encounter',
            sector: targetSector,
            warps: warpRefs,
            players: playersInSector,
            port,
            sectorDrones: sectorDrones.quantity,
            ownerId: sectorDrones.ownerId,
            ownerName: sectorDrones.ownerName,
            shipDrones: shipRes.rows[0]?.drones ?? 0,
            retreatSector: currentSector,
            turnsUsed: turnResult.turnsUsed,
        });

        // Alert the owner about the intrusion (skip for rogue drones)
        const owner = sectorDrones.ownerId != null ? players[sectorDrones.ownerId] : undefined;
        if (owner && owner.ws.readyState === 1 && sectorDrones.ownerId != null) {
            sendEnvelope(sectorDrones.ownerId, {
                type: ServerMsgType.SectorDronesAlert,
                event: 'intrusion',
                sector: targetSector,
                dronesLost: 0,
                dronesRemaining: sectorDrones.quantity,
                intruderName: player.name,
            });
        }
        return;
    }

    await setPlayerMenu(playerId, 'sector');
    sendEnvelope(playerId, {
        type: ServerMsgType.MoveResult,
        outcome: 'success',
        sector: targetSector,
        warps: warpRefs,
        players: playersInSector,
        port,
        sectorDrones,
        planets,
        turnsUsed: turnResult.turnsUsed,
    });
}

export async function handleSectorDisplay(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;
    const currentSector = player.sector;
    const universeId = player.universeId;

    const [port, warpRefs, sectorDrones, planetsRes] = await Promise.all([
        getPortForSector(currentSector, universeId),
        getWarpRefs(playerId, currentSector, universeId),
        getSectorDrones(currentSector, universeId),
        pool.query(
            `SELECT pl.id, pl.name, pl.type FROM planets pl
             JOIN sectors s ON pl.sector_id = s.id
             WHERE s.sector_number = $1 AND s.universe_id = $2 ORDER BY pl.id`,
            [currentSector, universeId],
        ),
    ]);
    const planets = planetsRes.rows;
    const playersInSector = Object.entries(players)
        .filter(
            ([id, p]) =>
                p.sector === currentSector &&
                p.universeId === universeId &&
                !p.docked &&
                Number(id) !== playerId,
        )
        .map(([id, p]) => ({ id: Number(id), name: p.name }));
    sendEnvelope(playerId, {
        type: ServerMsgType.SectorDisplayResult,
        sector: currentSector,
        warps: warpRefs,
        players: playersInSector,
        port,
        sectorDrones,
        planets,
    });
}

export async function handleWarpsOut(playerId: number, id: number): Promise<void> {
    if (!Number.isInteger(id) || id <= 0) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Invalid sector ID' });
        return;
    }

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    const sectorRes = await pool.query(
        'SELECT id FROM sectors WHERE sector_number = $1 AND universe_id = $2',
        [id, universeId],
    );
    if (sectorRes.rows.length === 0) {
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
        sendEnvelope(playerId, { type: ServerMsgType.ShortestPathResult, path: [{ sector: from, visited: true }], hops: 0 });
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

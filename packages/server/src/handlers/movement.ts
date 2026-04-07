import { WebSocket } from 'ws';
import { ServerMsgType } from '@twnr/shared';
import {
    players,
    sendEnvelope,
    broadcastTo,
    getGraph,
    getPortForSector,
    getVisitedSectors,
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

    const shipRes = await pool.query('SELECT player_id FROM player_ships WHERE player_id = $1', [
        playerId,
    ]);
    if (shipRes.rows.length === 0) {
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
        'SELECT turns_per_warp FROM player_ships WHERE player_id = $1',
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

    const [port, visitedSectors, sectorDrones, planetsRes] = await Promise.all([
        getPortForSector(targetSector, universeId),
        getVisitedSectors(playerId),
        getSectorDrones(targetSector, universeId),
        pool.query(
            `SELECT pl.id, pl.name, pl.type FROM planets pl
             JOIN sectors s ON pl.sector_id = s.id
             WHERE s.sector_number = $1 AND s.universe_id = $2 ORDER BY pl.id`,
            [targetSector, universeId],
        ),
    ]);
    const planets = planetsRes.rows;
    const displayWarps = warps[targetSector] || [];
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

        const shipRes = await pool.query('SELECT drones FROM player_ships WHERE player_id = $1', [
            playerId,
        ]);

        sendEnvelope(playerId, {
            type: ServerMsgType.MoveResult,
            outcome: 'encounter',
            sector: targetSector,
            warps: displayWarps,
            players: playersInSector,
            port,
            visitedSectors,
            sectorDrones: sectorDrones.quantity,
            ownerId: sectorDrones.ownerId,
            ownerName: sectorDrones.ownerName,
            shipDrones: shipRes.rows[0]?.drones ?? 0,
            retreatSector: currentSector,
            turnsUsed: turnResult.turnsUsed,
        });

        // Alert the owner about the intrusion
        const owner = players[sectorDrones.ownerId];
        if (owner && owner.ws.readyState === 1) {
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

    sendEnvelope(playerId, {
        type: ServerMsgType.MoveResult,
        outcome: 'success',
        sector: targetSector,
        warps: displayWarps,
        players: playersInSector,
        port,
        visitedSectors,
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

    const [warps, port, visitedSectors, sectorDrones, planetsRes] = await Promise.all([
        getGraph(universeId),
        getPortForSector(currentSector, universeId),
        getVisitedSectors(playerId),
        getSectorDrones(currentSector, universeId),
        pool.query(
            `SELECT pl.id, pl.name, pl.type FROM planets pl
             JOIN sectors s ON pl.sector_id = s.id
             WHERE s.sector_number = $1 AND s.universe_id = $2 ORDER BY pl.id`,
            [currentSector, universeId],
        ),
    ]);
    const planets = planetsRes.rows;
    const displayWarps = warps[currentSector] || [];
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
        warps: displayWarps,
        players: playersInSector,
        port,
        visitedSectors,
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

    const warpsRes = await pool.query(
        `SELECT s_to.sector_number as sector_to
         FROM warps w
         JOIN sectors s_from ON w.from_sector_id = s_from.id
         JOIN sectors s_to ON w.to_sector_id = s_to.id
         WHERE s_from.sector_number = $1 AND s_from.universe_id = $2`,
        [id, universeId],
    );
    const warps = warpsRes.rows.map((r) => r.sector_to);
    sendEnvelope(playerId, { type: ServerMsgType.WarpsOutResult, id, warps });
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
        sendEnvelope(playerId, { type: ServerMsgType.ShortestPathResult, path: [from], hops: 0 });
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
                sendEnvelope(playerId, {
                    type: ServerMsgType.ShortestPathResult,
                    path: finalPath,
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

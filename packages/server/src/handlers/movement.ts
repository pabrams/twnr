import { WebSocket } from 'ws';
import { ServerMsgType } from '@twnr/shared';
import {
    players,
    send,
    broadcastTo,
    getGraph,
    getPortForSector,
    getVisitedSectors,
    getPlayerUniverseId,
} from '../game-state.js';
import { pool } from '../db/index.js';

export async function handleMove(
    ws: WebSocket,
    playerId: number,
    targetSector: number,
): Promise<void> {
    if (!Number.isInteger(targetSector) || targetSector <= 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Invalid sector' });
        return;
    }

    const shipRes = await pool.query('SELECT player_id FROM player_ships WHERE player_id = $1', [
        playerId,
    ]);
    if (shipRes.rows.length === 0) {
        send(ws, { type: ServerMsgType.NoShip });
        return;
    }

    const player = players[playerId];
    if (!player) return;

    const universeId = player.universeId;
    const warps = await getGraph(universeId);
    const currentSector = player.sector;

    if (!warps[currentSector]?.includes(targetSector)) {
        send(ws, { type: ServerMsgType.NonAdjacentMoveRequested, playerId, sector: targetSector });
        return;
    }

    // Undock if docked
    if (player.docked) {
        player.docked = false;
        await pool.query('UPDATE players SET docked = FALSE WHERE id = $1', [playerId]);
    }

    player.sector = targetSector;
    await Promise.all([
        pool.query('UPDATE players SET current_sector = $1 WHERE id = $2', [
            targetSector,
            playerId,
        ]),
        pool.query(
            'INSERT INTO visited_sectors (player_id, sector_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [playerId, targetSector],
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

    const [port, visitedSectors] = await Promise.all([
        getPortForSector(targetSector, universeId),
        getVisitedSectors(playerId),
    ]);
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
    send(ws, {
        type: ServerMsgType.SectorDisplay,
        sector: targetSector,
        warps: displayWarps,
        players: playersInSector,
        port,
        visitedSectors,
    });
}

export async function handleSectorDisplay(ws: WebSocket, playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;
    const currentSector = player.sector;
    const universeId = player.universeId;

    const [warps, port, visitedSectors] = await Promise.all([
        getGraph(universeId),
        getPortForSector(currentSector, universeId),
        getVisitedSectors(playerId),
    ]);
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
    send(ws, {
        type: ServerMsgType.SectorDisplay,
        sector: currentSector,
        warps: displayWarps,
        players: playersInSector,
        port,
        visitedSectors,
    });
}

export async function handleSectorWarps(
    ws: WebSocket,
    playerId: number,
    id: number,
): Promise<void> {
    if (!Number.isInteger(id) || id <= 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Invalid sector ID' });
        return;
    }

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    const sectorRes = await pool.query(
        'SELECT id FROM sectors WHERE id = $1 AND universe_id = $2',
        [id, universeId],
    );
    if (sectorRes.rows.length === 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Sector not found' });
        return;
    }

    const warpsRes = await pool.query(
        'SELECT sector_to FROM warps WHERE sector_from = $1 AND universe_id = $2',
        [id, universeId],
    );
    const warps = warpsRes.rows.map((r) => r.sector_to);
    send(ws, { type: ServerMsgType.SectorWarps, id, warps });
}

export async function handlePath(
    ws: WebSocket,
    playerId: number,
    from: number,
    to: number,
): Promise<void> {
    if (!Number.isInteger(from) || from <= 0 || !Number.isInteger(to) || to <= 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Invalid sector ID' });
        return;
    }

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    const sectorRes = await pool.query(
        'SELECT id FROM sectors WHERE id IN ($1, $2) AND universe_id = $3',
        [from, to, universeId],
    );
    if (sectorRes.rows.length !== (from === to ? 1 : 2)) {
        const foundIds = new Set(sectorRes.rows.map((r: any) => r.id));
        if (!foundIds.has(from) || !foundIds.has(to)) {
            send(ws, { type: ServerMsgType.Error, message: 'Sector not found' });
            return;
        }
    }

    if (from === to) {
        send(ws, { type: ServerMsgType.PathResult, path: [from], hops: 0 });
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
                send(ws, {
                    type: ServerMsgType.PathResult,
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

    send(ws, { type: ServerMsgType.Error, message: 'No path found' });
}

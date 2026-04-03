import { WebSocket } from 'ws';
import type { ServerMessage } from '@twnr/shared';
import { pool } from './db/index.js';

export interface Player {
    ws: WebSocket;
    sector: number;
    name: string;
    universeId: number;
    docked: boolean;
}

export const players: Record<number, Player> = {};

export const PORT_CLASS_ACTIONS: Record<number, Record<string, 'B' | 'S'>> = {
    1: { fuel: 'B', organics: 'B', equipment: 'S' },
    2: { fuel: 'B', organics: 'S', equipment: 'B' },
    3: { fuel: 'S', organics: 'B', equipment: 'B' },
    4: { fuel: 'S', organics: 'S', equipment: 'B' },
    5: { fuel: 'B', organics: 'S', equipment: 'S' },
    6: { fuel: 'S', organics: 'B', equipment: 'S' },
    7: { fuel: 'S', organics: 'S', equipment: 'S' },
    8: { fuel: 'B', organics: 'B', equipment: 'B' },
};

export function portName(sectorId: number): string {
    return `Port ${sectorId}`;
}

export async function getVisitedSectors(playerId: number): Promise<number[]> {
    const res = await pool.query('SELECT sector_id FROM visited_sectors WHERE player_id = $1', [
        playerId,
    ]);
    return res.rows.map((r: any) => r.sector_id);
}

export async function getPortForSector(
    sectorId: number,
    universeId: number,
): Promise<{ class: number; name: string } | null> {
    const res = await pool.query(
        'SELECT class FROM ports WHERE sector_id = $1 AND universe_id = $2',
        [sectorId, universeId],
    );
    if (res.rows.length === 0) return null;
    return { class: res.rows[0].class, name: portName(sectorId) };
}

/**
 * Builds the sector warp adjacency list for a specific universe.
 */
export async function getGraph(universeId: number): Promise<number[][]> {
    const sectorsRes = await pool.query(
        'SELECT id FROM sectors WHERE universe_id = $1 ORDER BY id ASC',
        [universeId],
    );
    const size = sectorsRes.rows.length;

    if (size === 0) {
        return [];
    }

    const maxId = sectorsRes.rows[size - 1].id;
    let adjacencyList: number[][] = [];
    for (let i = 0; i <= maxId; i++) {
        adjacencyList[i] = [];
    }

    const warpsRes = await pool.query(
        'SELECT sector_from, sector_to FROM warps WHERE universe_id = $1',
        [universeId],
    );
    for (const row of warpsRes.rows) {
        if (adjacencyList[row.sector_from]) {
            adjacencyList[row.sector_from].push(row.sector_to);
        }
    }

    return adjacencyList;
}

export function broadcastTo(data: ServerMessage, targetClients: Set<WebSocket> | WebSocket[]) {
    for (const client of targetClients) {
        if (client.readyState === 1) {
            client.send(JSON.stringify(data));
        }
    }
}

export function send(ws: WebSocket, data: ServerMessage) {
    ws.send(JSON.stringify(data));
}

export function getPlayerUniverseId(playerId: number): number | undefined {
    return players[playerId]?.universeId;
}

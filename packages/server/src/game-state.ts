import { WebSocket } from 'ws';
import type { ServerResult } from '@twnr/shared';
import { pool } from './db/index.js';

export interface Player {
    ws: WebSocket;
    sector: number;
    name: string;
    universeId: number;
    docked: boolean;
    at_stardock?: boolean;
    pendingEncounter?: { retreatSector: number };
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
    sectorNumber: number,
    universeId: number,
): Promise<{ class: number; name: string } | null> {
    const res = await pool.query(
        `SELECT p.class FROM ports p
         JOIN sectors s ON p.sector_id = s.id
         WHERE s.sector_number = $1 AND s.universe_id = $2`,
        [sectorNumber, universeId],
    );
    if (res.rows.length === 0) return null;
    return { class: res.rows[0].class, name: portName(sectorNumber) };
}

/**
 * Builds the sector warp adjacency list for a specific universe.
 */
export async function getGraph(universeId: number): Promise<number[][]> {
    const sectorsRes = await pool.query(
        'SELECT sector_number FROM sectors WHERE universe_id = $1 ORDER BY sector_number ASC',
        [universeId],
    );
    const size = sectorsRes.rows.length;

    if (size === 0) {
        return [];
    }

    const maxId = sectorsRes.rows[size - 1].sector_number;
    let adjacencyList: number[][] = [];
    for (let i = 0; i <= maxId; i++) {
        adjacencyList[i] = [];
    }

    const warpsRes = await pool.query(
        `SELECT s_from.sector_number as sector_from, s_to.sector_number as sector_to
         FROM warps w
         JOIN sectors s_from ON w.from_sector_id = s_from.id
         JOIN sectors s_to ON w.to_sector_id = s_to.id
         WHERE s_from.universe_id = $1`,
        [universeId],
    );
    for (const row of warpsRes.rows) {
        if (adjacencyList[row.sector_from]) {
            adjacencyList[row.sector_from].push(row.sector_to);
        }
    }

    return adjacencyList;
}

export function broadcastTo(data: ServerResult, targetClients: Set<WebSocket> | WebSocket[]) {
    for (const client of targetClients) {
        if (client.readyState === 1) {
            client.send(JSON.stringify(data));
        }
    }
}

export function send(ws: WebSocket, data: ServerResult) {
    ws.send(JSON.stringify(data));
}

export function getPlayerUniverseId(playerId: number): number | undefined {
    return players[playerId]?.universeId;
}

export async function getSectorFighters(
    sectorNumber: number,
    universeId: number,
): Promise<{ quantity: number; ownerId: number; ownerName: string } | null> {
    const res = await pool.query(
        `SELECT sf.quantity, sf.owner_id, p.name as owner_name
         FROM sector_fighters sf
         JOIN sectors s ON sf.sector_id = s.id
         JOIN players p ON sf.owner_id = p.id
         WHERE s.sector_number = $1 AND s.universe_id = $2 AND sf.quantity > 0`,
        [sectorNumber, universeId],
    );
    if (res.rows.length === 0) return null;
    return {
        quantity: res.rows[0].quantity,
        ownerId: res.rows[0].owner_id,
        ownerName: res.rows[0].owner_name,
    };
}

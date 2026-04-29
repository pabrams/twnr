import type { WebSocket } from 'ws';
import type { ServerResult } from '@twnr/shared';
import { ServerMsgType } from '@twnr/shared';
import { players } from './players.js';

/**
 * Send a payload to a set of WebSocket clients. Each frame is wrapped in
 * the standard envelope `{ menu, payload }` where `menu` reflects the
 * recipient's current menu (resolved by looking up the matching player
 * record). Used by handlers that need to broadcast to "everyone in this
 * sector" or similar.
 */
export function broadcastTo(data: ServerResult, targetClients: Set<WebSocket> | WebSocket[]): void {
    for (const client of targetClients) {
        if (client.readyState === 1) {
            const entry = Object.values(players).find((p) => p.ws === client);
            const menu = entry?.currentMenu ?? 'sector';
            client.send(JSON.stringify({ menu, payload: data }));
        }
    }
}

/**
 * Send a server result to a single player by id.
 */
export function sendEnvelope(playerId: number, data?: ServerResult): void {
    const player = players[playerId];
    if (!player || player.ws.readyState !== 1) return;
    const frame = data ? { menu: player.currentMenu, payload: data } : { menu: player.currentMenu };
    player.ws.send(JSON.stringify(frame));
}

/** Convenience: emit an Error result to a single player. */
export function sendError(playerId: number, message: string): void {
    sendEnvelope(playerId, { type: ServerMsgType.Error, message });
}

/**
 * Like broadcastTo but addresses by player id instead of WebSocket. Used
 * when callers already have a list of target playerIds (e.g. "everyone in
 * this universe").
 */
export function broadcastEnvelope(data: ServerResult, targetPlayerIds: number[]): void {
    for (const pid of targetPlayerIds) {
        const player = players[pid];
        if (player && player.ws.readyState === 1) {
            player.ws.send(JSON.stringify({ menu: player.currentMenu, payload: data }));
        }
    }
}

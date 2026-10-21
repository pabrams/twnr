import type { WebSocket } from 'ws';
import type { ServerEnvelope } from '@twnr/shared';
import { ServerTag } from '@twnr/shared';
import { onlinePlayers } from './players.js';

function frame(body: ServerEnvelope): string {
    return JSON.stringify(body);
}

export async function sendEnvelope(playerId: number, body: ServerEnvelope): Promise<void> {
    const player = onlinePlayers[playerId];
    if (!player || player.ws.readyState !== 1) return;
    player.ws.send(frame(body));
}

export function sendError(playerId: number, message: string): void {
    const player = onlinePlayers[playerId];
    if (!player || player.ws.readyState !== 1) return;
    player.ws.send(frame({ type: ServerTag.Error, message }));
}

/** Call only after the destruction payload has been sent. */
export function closeDestroyedSession(playerId: number, reason: string): void {
    const player = onlinePlayers[playerId];
    if (!player || player.ws.readyState !== 1) return;
    player.ws.close(1008, reason);
}

export function broadcastTo(
    data: ServerEnvelope,
    targetClients: Set<WebSocket> | WebSocket[],
): void {
    for (const client of targetClients) {
        if (client.readyState === 1) {
            client.send(frame(data));
        }
    }
}

export function broadcastEnvelope(data: ServerEnvelope, targetPlayerIds: number[]): void {
    for (const pid of targetPlayerIds) {
        const player = onlinePlayers[pid];
        if (player && player.ws.readyState === 1) {
            player.ws.send(frame(data));
        }
    }
}

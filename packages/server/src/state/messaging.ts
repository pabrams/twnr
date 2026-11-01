import type { WebSocket } from 'ws';
import type { ServerEnvelope } from '@twnr/shared';
import { Events } from '@twnr/shared';
import { onlinePlayers } from './players.js';

function frame(body: ServerEnvelope): string {
    return JSON.stringify(body);
}

export async function sendEnvelope(playerId: number, body: ServerEnvelope): Promise<void> {
    const player = onlinePlayers[playerId];
    if (!player || player.ws.readyState !== 1) return;
    player.ws.send(frame(body));
}

/** Only for faults: a request the schema rejected, or a server failure. Game refusals are replies. */
export function sendProtocolError(
    playerId: number,
    reason: 'rejected' | 'exception',
    message: string,
): void {
    const player = onlinePlayers[playerId];
    if (!player || player.ws.readyState !== 1) return;
    player.ws.send(frame({ type: Events.ProtocolError.name, reason, message }));
}

/** Deferred a tick so a reply the current handler returns still reaches the player before the socket closes. */
export function closeDestroyedSession(playerId: number, reason: string): void {
    setImmediate(() => {
        const player = onlinePlayers[playerId];
        if (!player || player.ws.readyState !== 1) return;
        player.ws.close(1008, reason);
    });
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

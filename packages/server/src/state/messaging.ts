import type { WebSocket } from 'ws';
import type { ServerEnvelope } from '@twnr/shared';
import { ServerTag } from '@twnr/shared';
import { players } from './players.js';

function frame(body: ServerEnvelope): string {
    return JSON.stringify(body);
}

export async function sendEnvelope(playerId: number, body: ServerEnvelope): Promise<void> {
    const player = players[playerId];
    if (!player || player.ws.readyState !== 1) return;
    player.ws.send(frame(body));
}

/** Emit an Error result. */
export function sendError(playerId: number, message: string): void {
    const player = players[playerId];
    if (!player || player.ws.readyState !== 1) return;
    player.ws.send(frame({ type: ServerTag.Error, message }));
}

/**
 * Close the WebSocket of a destroyed player with a 1008 policy-violation
 * frame carrying the reason text. All destruction sites (combat, mines,
 * future planet-collisions, etc.) call this after their reason-specific
 * payload (AttackShipResult, MoveResult-destroyed, ProximityMineHit, ...)
 * has been sent, so the client always sees the same terminal step.
 */
export function closeDestroyedSession(playerId: number, reason: string): void {
    const player = players[playerId];
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

/** Broadcast a result by player id. */
export function broadcastEnvelope(data: ServerEnvelope, targetPlayerIds: number[]): void {
    for (const pid of targetPlayerIds) {
        const player = players[pid];
        if (player && player.ws.readyState === 1) {
            player.ws.send(frame(data));
        }
    }
}

import { ServerTag } from '@twnr/shared';
import type { HailResolveCommand, HailSendCommand } from '@twnr/shared';
import { players, getPlayerUniverseId } from '../state/players.js';
import { sendEnvelope, sendError } from '../state/messaging.js';
import { findPlayersByNamePrefix } from '../db/queries/player.js';
import { insertMemo } from '../db/queries/message.js';

const MAX_HAIL_BODY = 2000;

export async function serveHailResolve(
    playerId: number,
    data: HailResolveCommand,
): Promise<void> {
    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;
    const prefix = data.name.trim();
    if (prefix.length === 0) {
        sendEnvelope(playerId, { type: ServerTag.HailResolveResult, outcome: 'notFound' });
        return;
    }
    const matches = await findPlayersByNamePrefix(universeId, prefix);
    if (matches.length === 0) {
        sendEnvelope(playerId, { type: ServerTag.HailResolveResult, outcome: 'notFound' });
        return;
    }
    if (matches.length > 1) {
        sendEnvelope(playerId, {
            type: ServerTag.HailResolveResult,
            outcome: 'ambiguous',
            matches: matches.map((m) => m.name),
        });
        return;
    }
    const target = matches[0];
    if (target.id === playerId) {
        sendEnvelope(playerId, { type: ServerTag.HailResolveResult, outcome: 'self' });
        return;
    }
    sendEnvelope(playerId, {
        type: ServerTag.HailResolveResult,
        outcome: 'found',
        recipientPlayerId: target.id,
        recipientName: target.name,
        online: players[target.id] !== undefined,
    });
}

export async function serveHailSend(
    playerId: number,
    data: HailSendCommand,
): Promise<void> {
    const body = data.body;
    if (typeof body !== 'string' || body.trim().length === 0) {
        sendError(playerId, 'Empty message.');
        return;
    }
    if (body.length > MAX_HAIL_BODY) {
        sendError(playerId, `Message too long (max ${MAX_HAIL_BODY}).`);
        return;
    }
    const sender = players[playerId];
    if (!sender) return;
    const recipient = players[data.recipientPlayerId];
    if (recipient) {
        sendEnvelope(data.recipientPlayerId, {
            type: ServerTag.HailIncoming,
            senderName: sender.name,
            body,
        });
        sendEnvelope(playerId, { type: ServerTag.HailSendResult, outcome: 'delivered' });
        return;
    }
    await insertMemo(data.recipientPlayerId, playerId, null, 'hail', body);
    sendEnvelope(playerId, { type: ServerTag.HailSendResult, outcome: 'queued' });
}

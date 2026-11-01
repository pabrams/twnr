import { Events } from '@twnr/shared';
import type { CommandRequest } from '@twnr/shared';
import { onlinePlayers, requireOnlinePlayer } from '../state/players.js';
import { sendEnvelope } from '../state/messaging.js';
import { findPlayersByNamePrefix } from '../db/queries/player.js';
import { insertMemo } from '../db/queries/message.js';
import { type CommandResult } from './command.js';

export async function serveHailResolve(
    playerId: number,
    data: CommandRequest<'HailResolve'>,
): Promise<CommandResult<'HailResolve'>> {
    const { universeId } = requireOnlinePlayer(playerId);
    const prefix = data.name.trim();
    if (prefix.length === 0) {
        return { outcome: 'notFound' };
    }
    const matches = await findPlayersByNamePrefix(universeId, prefix);
    if (matches.length === 0) {
        return { outcome: 'notFound' };
    }
    if (matches.length > 1) {
        return {
            outcome: 'ambiguous',
            matches: matches.map((m) => m.name),
        };
    }
    const target = matches[0];
    if (target.id === playerId) {
        return { outcome: 'self' };
    }
    return {
        outcome: 'found',
        recipientPlayerId: target.id,
        recipientName: target.name,
        online: onlinePlayers[target.id] !== undefined,
    };
}

export async function serveHailSend(
    playerId: number,
    data: CommandRequest<'HailSend'>,
): Promise<CommandResult<'HailSend'>> {
    const body = data.body;
    const sender = requireOnlinePlayer(playerId);
    const recipient = onlinePlayers[data.recipientPlayerId];
    if (recipient) {
        sendEnvelope(data.recipientPlayerId, {
            type: Events.HailReceived.name,
            senderName: sender.name,
            body,
        });
        return { outcome: 'delivered' };
    }
    await insertMemo(data.recipientPlayerId, playerId, null, 'hail', body);
    return { outcome: 'queued' };
}

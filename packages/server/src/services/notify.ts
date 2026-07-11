import { ServerTag } from '@twnr/shared';
import { onlinePlayers } from '../state/players.js';
import { sendEnvelope } from '../state/messaging.js';
import { insertMemo, insertSystemMemo } from '../db/queries/message.js';

export type NotifySender =
    | { kind: 'player'; playerId: number; displayName: string }
    | { kind: 'system'; label: string };

export function notifyTurnChange(playerId: number, turnsDelta: number, reason: string): void {
    if (!onlinePlayers[playerId]) return;
    if (turnsDelta === 0) return;
    if (reason === 'warping') return;
    const body =
        turnsDelta > 0
            ? `${turnsDelta} turn(s) deducted for ${reason}.`
            : `${Math.abs(turnsDelta)} turn(s) granted for ${reason}.`;
    sendEnvelope(playerId, { type: ServerTag.Notice, senderLabel: null, body });
}

export async function notifyAndMail(opts: {
    recipientId: number;
    sender: NotifySender;
    kind: string;
    body: string;
    clanId?: number | null;
}): Promise<void> {
    const { recipientId, sender, kind, body, clanId = null } = opts;
    let notifyLabel: string;
    if (sender.kind === 'player') {
        await insertMemo(recipientId, sender.playerId, clanId, kind, body);
        notifyLabel = sender.displayName;
    } else {
        await insertSystemMemo(recipientId, sender.label, kind, body);
        notifyLabel = sender.label;
    }
    if (onlinePlayers[recipientId]) {
        sendEnvelope(recipientId, {
            type: ServerTag.Notice,
            senderLabel: notifyLabel,
            body,
        });
    }
}

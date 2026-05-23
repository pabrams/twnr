import { ServerTag } from '@twnr/shared';
import { players } from '../state/players.js';
import { sendEnvelope } from '../state/messaging.js';
import { insertMemo, insertSystemMemo } from '../db/queries/message.js';

export type NotifySender =
    | { kind: 'player'; playerId: number; displayName: string }
    | { kind: 'system'; label: string };

/** Push a one-shot Notice describing experience and/or alignment deltas.
 *  Skips silently when both are zero. Pairs with adjustReputationAndExperience
 *  call sites that previously moved attributes without telling the player. */
export function notifyAttributeChange(
    playerId: number,
    repDelta: number,
    expDelta: number,
    reason: string,
): void {
    if (!players[playerId]) return;
    if (repDelta === 0 && expDelta === 0) return;
    const lines: string[] = [];
    if (expDelta !== 0) {
        const verb = expDelta > 0 ? 'receive' : 'lose';
        lines.push(`You ${verb} ${Math.abs(expDelta)} experience point(s) for ${reason}.`);
    }
    if (repDelta !== 0) {
        const dir = repDelta > 0 ? 'went up' : 'went down';
        lines.push(`Your alignment ${dir} by ${Math.abs(repDelta)} point(s) for ${reason}.`);
    }
    sendEnvelope(playerId, {
        type: ServerTag.Notice,
        senderLabel: null,
        body: lines.join('\n'),
    });
}

export function notifyTurnChange(playerId: number, turnsDelta: number, reason: string): void {
    if (!players[playerId]) return;
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
    if (players[recipientId]) {
        sendEnvelope(recipientId, {
            type: ServerTag.Notice,
            senderLabel: notifyLabel,
            body,
        });
    }
}

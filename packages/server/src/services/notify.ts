import { ServerTag } from '@twnr/shared';
import { players } from '../state/players.js';
import { sendEnvelope } from '../state/messaging.js';
import { insertMemo, insertSystemMemo } from '../db/queries/message.js';

export type NotifySender =
    | { kind: 'player'; playerId: number; displayName: string }
    | { kind: 'system'; label: string };

/**
 * Combined mail + notification for an event the recipient needs to know
 * about. Always writes a row to the recipient's inbox; if the recipient is
 * online, also pushes a Notice envelope so they see it inline immediately.
 *
 * Sender is either a player (mail row gets sender_player_id; notification
 * label = displayName) or a system label (mail row gets sender_label; both
 * use the same label string).
 */
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

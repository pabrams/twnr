import { ServerTag } from '@twnr/shared';
import { sendEnvelope } from '../state/messaging.js';
import {
    getAllMailForPlayer,
    getMailSince,
    deleteAllMailForPlayer,
    getPlayerLastLogoutAt,
} from '../db/queries/message.js';

export async function serveReadMail(playerId: number): Promise<void> {
    const rows = await getAllMailForPlayer(playerId);
    sendEnvelope(playerId, {
        type: ServerTag.MemoDelivery,
        reason: 'read',
        memos: rows.map((m) => ({
            id: m.id,
            senderName: m.sender_name,
            kind: m.kind,
            body: m.body,
            createdAt: m.created_at.toISOString(),
        })),
    });
}

export async function serveDeleteAllMail(playerId: number): Promise<void> {
    await deleteAllMailForPlayer(playerId);
}

export async function serveCheckMailSinceLastLogout(playerId: number): Promise<void> {
    const lastLogout = await getPlayerLastLogoutAt(playerId);
    const rows = await getMailSince(playerId, lastLogout);
    sendEnvelope(playerId, {
        type: ServerTag.MemoDelivery,
        reason: 'connect',
        memos: rows.map((m) => ({
            id: m.id,
            senderName: m.sender_name,
            kind: m.kind,
            body: m.body,
            createdAt: m.created_at.toISOString(),
        })),
    });
}

import {
    getAllMailForPlayer,
    getMailSince,
    deleteAllMailForPlayer,
    getPlayerLastLogoutAt,
} from '../db/queries/message.js';
import { type CommandResult } from './command.js';

export async function serveReadMail(playerId: number): Promise<CommandResult<'ReadMail'>> {
    const rows = await getAllMailForPlayer(playerId);
    return {
        outcome: 'ok',
        memos: rows.map((m) => ({
            id: m.id,
            senderName: m.sender_name,
            kind: m.kind,
            body: m.body,
            createdAt: m.created_at.toISOString(),
        })),
    };
}

export async function serveDeleteAllMail(
    playerId: number,
): Promise<CommandResult<'DeleteAllMail'>> {
    await deleteAllMailForPlayer(playerId);
}

export async function serveCheckMailSinceLastLogout(
    playerId: number,
): Promise<CommandResult<'CheckMailSinceLastLogout'>> {
    const lastLogout = await getPlayerLastLogoutAt(playerId);
    const rows = await getMailSince(playerId, lastLogout);
    return {
        outcome: 'ok',
        memos: rows.map((m) => ({
            id: m.id,
            senderName: m.sender_name,
            kind: m.kind,
            body: m.body,
            createdAt: m.created_at.toISOString(),
        })),
    };
}

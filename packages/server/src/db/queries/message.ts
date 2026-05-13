import { pool } from '../index.js';
import type { Queryable } from '../types.js';

export type MessageRow = {
    id: number;
    sender_player_id: number | null;
    sender_name: string | null;
    clan_id: number | null;
    kind: string;
    body: string;
    created_at: Date;
};

export async function insertMemo(
    recipientPlayerId: number,
    senderPlayerId: number | null,
    clanId: number | null,
    kind: string,
    body: string,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `INSERT INTO messages (recipient_player_id, sender_player_id, clan_id, kind, body)
         VALUES ($1, $2, $3, $4, $5)`,
        [recipientPlayerId, senderPlayerId, clanId, kind, body],
    );
}

export async function getAllMailForPlayer(
    recipientPlayerId: number,
    db: Queryable = pool,
): Promise<MessageRow[]> {
    const res = await db.query<MessageRow>(
        `SELECT m.id, m.sender_player_id, m.clan_id, m.kind, m.body, m.created_at,
                p.name AS sender_name
         FROM messages m
         LEFT JOIN players p ON p.id = m.sender_player_id
         WHERE m.recipient_player_id = $1
         ORDER BY m.id ASC`,
        [recipientPlayerId],
    );
    return res.rows;
}

export async function getMailSince(
    recipientPlayerId: number,
    since: Date | null,
    db: Queryable = pool,
): Promise<MessageRow[]> {
    const res = await db.query<MessageRow>(
        `SELECT m.id, m.sender_player_id, m.clan_id, m.kind, m.body, m.created_at,
                p.name AS sender_name
         FROM messages m
         LEFT JOIN players p ON p.id = m.sender_player_id
         WHERE m.recipient_player_id = $1
           AND ($2::timestamptz IS NULL OR m.created_at > $2)
         ORDER BY m.id ASC`,
        [recipientPlayerId, since],
    );
    return res.rows;
}

export async function deleteAllMailForPlayer(
    recipientPlayerId: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query('DELETE FROM messages WHERE recipient_player_id = $1', [recipientPlayerId]);
}

export async function getPlayerLastLogoutAt(
    playerId: number,
    db: Queryable = pool,
): Promise<Date | null> {
    const res = await db.query<{ last_logout_at: Date | null }>(
        'SELECT last_logout_at FROM players WHERE id = $1',
        [playerId],
    );
    return res.rows[0]?.last_logout_at ?? null;
}

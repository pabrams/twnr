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

export async function fetchAndMarkUnreadMemos(
    recipientPlayerId: number,
    db: Queryable = pool,
): Promise<MessageRow[]> {
    const res = await db.query<MessageRow>(
        `UPDATE messages SET read_at = NOW()
         WHERE recipient_player_id = $1 AND read_at IS NULL
         RETURNING id, sender_player_id, clan_id, kind, body, created_at,
                   (SELECT name FROM players WHERE id = messages.sender_player_id) AS sender_name`,
        [recipientPlayerId],
    );
    return res.rows.sort((a, b) => a.id - b.id);
}

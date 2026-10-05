import { pool } from '../index.js';
import type { Queryable } from '../types.js';

export type AuditLogRow = {
    id: number;
    player_id: number;
    action_type: string;
    delta: number;
    prev_credits: number;
    new_credits: number;
    context: unknown;
    created_at: Date;
    hmac: string;
};

export async function insertAuditLogEntry(
    entry: Omit<AuditLogRow, 'id'>,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `INSERT INTO audit_log (player_id, action_type, delta, prev_credits, new_credits, context, created_at, hmac)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
            entry.player_id,
            entry.action_type,
            entry.delta,
            entry.prev_credits,
            entry.new_credits,
            entry.context === null ? null : JSON.stringify(entry.context),
            entry.created_at,
            entry.hmac,
        ],
    );
}

export async function listAuditLogForPlayer(
    playerId: number,
    db: Queryable = pool,
): Promise<AuditLogRow[]> {
    const res = await db.query<AuditLogRow>(
        `SELECT id, player_id, action_type, delta, prev_credits, new_credits,
                context, created_at, hmac
         FROM audit_log WHERE player_id = $1 ORDER BY id ASC`,
        [playerId],
    );
    return res.rows;
}

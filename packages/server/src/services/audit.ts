import crypto from 'crypto';
import type { Queryable } from '../db/types.js';

// Per-session HMAC key. Generated once at module load, kept in module-scope
// memory only — never persisted to env, file, or DB. Each server restart
// gets a fresh key, which is why audit_log is truncated at boot
// (entries signed with an old key can never verify under the new one).
const auditSecret: Buffer = crypto.randomBytes(32);

export type AuditActionType =
    | 'port_buy'
    | 'port_sell'
    | 'ship_exchange'
    | 'buy_holds'
    | 'buy_drones'
    | 'buy_shields'
    | 'buy_hardware'
    | 'build_port'
    | 'upgrade_port';

export type AuditEntryForSign = {
    player_id: number;
    action_type: string;
    delta: number;
    prev_credits: number;
    new_credits: number;
    context: unknown;
    created_at: Date;
};

export function signEntry(entry: AuditEntryForSign): string {
    const payload = JSON.stringify({
        player_id: entry.player_id,
        action_type: entry.action_type,
        delta: entry.delta,
        prev_credits: entry.prev_credits,
        new_credits: entry.new_credits,
        context: entry.context ?? null,
        created_at: entry.created_at.toISOString(),
    });
    return crypto.createHmac('sha256', auditSecret).update(payload).digest('hex');
}

/**
 * Insert an HMAC-signed audit row recording a credit change. Must be called
 * inside the same transaction (`client`) that mutated `players.credits` so the
 * audit row commits atomically with the balance update.
 *
 * `delta` is the signed credit change (negative = spend). `prevCredits` is the
 * balance before the change; `newCredits` is the balance after. The verifier
 * sums deltas over HMAC-valid rows and compares against the live balance.
 */
export async function recordCreditChange(
    client: Queryable,
    params: {
        playerId: number;
        actionType: AuditActionType;
        delta: number;
        prevCredits: number;
        newCredits: number;
        context?: unknown;
    },
): Promise<void> {
    const createdAt = new Date();
    const entry: AuditEntryForSign = {
        player_id: params.playerId,
        action_type: params.actionType,
        delta: params.delta,
        prev_credits: params.prevCredits,
        new_credits: params.newCredits,
        context: params.context ?? null,
        created_at: createdAt,
    };
    const hmac = signEntry(entry);
    await client.query(
        `INSERT INTO audit_log (player_id, action_type, delta, prev_credits, new_credits, context, created_at, hmac)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
            entry.player_id,
            entry.action_type,
            entry.delta,
            entry.prev_credits,
            entry.new_credits,
            entry.context === null ? null : JSON.stringify(entry.context),
            createdAt,
            hmac,
        ],
    );
}

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

/**
 * Recompute the HMAC for a stored row and return whether it matches what the
 * row actually has. Used by the verifier endpoint to detect tampering.
 */
export function verifyEntry(row: AuditLogRow): boolean {
    const expected = signEntry({
        player_id: row.player_id,
        action_type: row.action_type,
        delta: row.delta,
        prev_credits: row.prev_credits,
        new_credits: row.new_credits,
        context: row.context,
        created_at: row.created_at,
    });
    let actual: Buffer;
    try {
        actual = Buffer.from(row.hmac, 'hex');
    } catch {
        return false;
    }
    const expectedBuf = Buffer.from(expected, 'hex');
    if (actual.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, actual);
}

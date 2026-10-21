import crypto from 'crypto';
import type { Queryable } from '../db/types.js';
import { insertAuditLogEntry, type AuditLogRow } from '../db/queries/audit.js';

export type { AuditLogRow } from '../db/queries/audit.js';

// Per-session HMAC key, memory-only by design. A restart mints a fresh key,
// which is why audit_log is truncated at boot: old-key rows can never verify.
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
 * Must run inside the same transaction that mutated `players.credits` so the
 * audit row commits atomically with the balance. `delta` is signed (negative = spend);
 * the verifier sums deltas over HMAC-valid rows against the live balance.
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
    await insertAuditLogEntry({ ...entry, hmac }, client);
}

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

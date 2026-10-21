import type { PoolClient } from 'pg';
import { withTransaction } from '../db/index.js';
import { sendError } from '../state/messaging.js';

/** Aborting (throw AbortTransaction, or return undefined from `tx`) skips `onSuccess` and sends no reply — abort sites reply first. */
export async function runMutation<T>(
    playerId: number,
    label: string,
    tx: (client: PoolClient) => Promise<T>,
    onSuccess: (result: T) => void | Promise<void>,
    onError?: string | ((playerId: number) => void),
): Promise<void> {
    try {
        const result = await withTransaction(tx);
        if (result === undefined) return;
        await onSuccess(result);
    } catch (err) {
        console.error(`${label} error`, err);
        if (typeof onError === 'function') onError(playerId);
        else sendError(playerId, onError ?? 'Internal server error');
    }
}

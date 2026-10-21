import type { PoolClient } from 'pg';
import { withTransaction } from '../db/index.js';
import { sendError } from '../state/messaging.js';

/**
 * Throw AbortTransaction inside `tx` to roll back and skip `onSuccess` —
 * validation failures must send their own reply before aborting. `undefined`
 * from `tx` is treated as an abort.
 */
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

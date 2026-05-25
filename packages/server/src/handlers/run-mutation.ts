import type { PoolClient } from 'pg';
import { withTransaction } from '../db/index.js';
import { sendError } from '../state/messaging.js';

/**
 * Run a transactional mutation with uniform error handling — the shape ~30
 * handlers repeat by hand.
 *
 * `tx` runs inside withTransaction; throw AbortTransaction to roll back and
 * skip `onSuccess` (validation failures send their own reply before aborting).
 * `onSuccess` fires with the committed result only — withTransaction resolves
 * `undefined` on abort, which is skipped here. Unexpected errors are logged as
 * `${label} error` and answered with a failure reply: by default
 * `sendError(playerId, 'Internal server error')`, overridable via `onError`
 * (a custom message string, or a callback for a non-Error envelope).
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

import type { PoolClient } from 'pg';
import { pool } from './pool.js';

/**
 * Thrown inside a `withTransaction` callback to roll back and exit cleanly
 * without propagating an error. Any other thrown value is treated as an
 * unexpected failure, rolled back, and rethrown.
 */
export class AbortTransaction extends Error {
    constructor() {
        super('AbortTransaction');
        this.name = 'AbortTransaction';
    }
}

/**
 * Run `fn` inside a BEGIN/COMMIT block. Rolls back and rethrows on any error.
 * Throwing `AbortTransaction` rolls back and resolves to `undefined` instead.
 */
export async function withTransaction<T>(
    fn: (client: PoolClient) => Promise<T>,
): Promise<T | undefined> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        try {
            await client.query('ROLLBACK');
        } catch {
            // swallow rollback errors; original error is more informative
        }
        if (err instanceof AbortTransaction) return undefined;
        throw err;
    } finally {
        client.release();
    }
}

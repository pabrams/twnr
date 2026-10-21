import type { PoolClient } from 'pg';
import { pool } from './pool.js';

/** Throw inside a withTransaction callback to roll back and resolve undefined instead of rethrowing. */
export class AbortTransaction extends Error {
    constructor() {
        super('AbortTransaction');
        this.name = 'AbortTransaction';
    }
}

/** Any error rolls back and rethrows; AbortTransaction rolls back and resolves undefined. */
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

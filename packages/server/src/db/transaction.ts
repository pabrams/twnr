import type { PoolClient } from 'pg';
import { pool } from './pool.js';

export class AbortTransaction extends Error {
    constructor() {
        super('AbortTransaction');
        this.name = 'AbortTransaction';
    }
}

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
            /* ignore */
        }
        if (err instanceof AbortTransaction) return undefined;
        throw err;
    } finally {
        client.release();
    }
}

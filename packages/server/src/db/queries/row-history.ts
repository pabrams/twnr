import type { Queryable } from '../types.js';

/** Silences record_row_history() for the rest of the current transaction. */
export async function suppressRowHistoryInTransaction(client: Queryable): Promise<void> {
    await client.query(`SET LOCAL app.row_history_skip = 'on'`);
}

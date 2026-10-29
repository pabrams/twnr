import { pool } from '../index.js';
import type { Queryable } from '../types.js';

export type GameEventVisibility = 'galactic' | 'admin';

export type GameEventRow = {
    id: number;
    created_at: Date;
    universe_id: number;
    kind: string;
    visibility: GameEventVisibility;
    payload: unknown;
};

export async function insertGameEvent(
    universeId: number,
    kind: string,
    visibility: GameEventVisibility,
    payload: unknown,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `INSERT INTO game_events (universe_id, kind, visibility, payload)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [universeId, kind, visibility, JSON.stringify(payload)],
    );
}

export async function listGameEvents(
    universeId: number,
    db: Queryable = pool,
): Promise<GameEventRow[]> {
    const res = await db.query<GameEventRow>(
        `SELECT id::int AS id, created_at, universe_id, kind, visibility, payload
         FROM game_events
         WHERE universe_id = $1
         ORDER BY id ASC`,
        [universeId],
    );
    return res.rows;
}

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

export type GalacticNewsRow = {
    id: number;
    created_at: Date;
    kind: string;
    payload: unknown;
};

export async function getEarliestGalacticNewsAt(
    universeId: number,
    db: Queryable = pool,
): Promise<Date | null> {
    const res = await db.query<{ created_at: Date }>(
        `SELECT created_at FROM game_events
         WHERE universe_id = $1 AND visibility = 'galactic'
         ORDER BY id ASC LIMIT 1`,
        [universeId],
    );
    return res.rows[0]?.created_at ?? null;
}

export async function listGalacticNewsSince(
    universeId: number,
    since: Date,
    db: Queryable = pool,
): Promise<GalacticNewsRow[]> {
    const res = await db.query<GalacticNewsRow>(
        `SELECT id::int AS id, created_at, kind, payload
         FROM game_events
         WHERE universe_id = $1 AND visibility = 'galactic' AND created_at >= $2
         ORDER BY id ASC`,
        [universeId, since],
    );
    return res.rows;
}

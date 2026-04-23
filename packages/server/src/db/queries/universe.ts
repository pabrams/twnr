import { pool } from '../index.js';
import type { Queryable } from '../types.js';

/** Create a new universe row. Returns the id + canonical name. */
export async function createUniverse(
    name: string,
    db: Queryable = pool,
): Promise<{ id: number; name: string }> {
    const res = await db.query<{ id: number; name: string }>(
        'INSERT INTO universes (name) VALUES ($1) RETURNING id, name',
        [name],
    );
    return res.rows[0];
}

/** All universes + (if present) the user's player in each. */
export type UserUniverseRow = {
    id: number;
    name: string;
    created_at: Date;
    player_id: number | null;
    player_name: string | null;
};
export async function listUniversesForUser(
    userId: number,
    db: Queryable = pool,
): Promise<UserUniverseRow[]> {
    const res = await db.query<UserUniverseRow>(
        `SELECT u.id, u.name, u.created_at, p.id AS player_id, p.name AS player_name
         FROM universes u
         LEFT JOIN players p ON p.universe_id = u.id AND p.user_id = $1
         ORDER BY u.id`,
        [userId],
    );
    return res.rows;
}

/** Does a universe with the given id exist? */
export async function universeExists(universeId: number, db: Queryable = pool): Promise<boolean> {
    const res = await db.query('SELECT id FROM universes WHERE id = $1', [universeId]);
    return res.rows.length > 0;
}

/** Basic universe metadata for a stats display. */
export type UniverseBasicInfoRow = {
    id: number;
    name: string;
    seed: number | null;
    created_at: Date;
};
export async function getUniverseBasicInfo(
    universeId: number,
    db: Queryable = pool,
): Promise<UniverseBasicInfoRow | undefined> {
    const res = await db.query<UniverseBasicInfoRow>(
        'SELECT id, name, seed, created_at FROM universes WHERE id = $1',
        [universeId],
    );
    return res.rows[0];
}

/** Create a universe at generation time (with seed + edit). Returns id. */
export async function insertUniverseFull(
    name: string,
    seed: number,
    editId: number | null,
    db: Queryable = pool,
    topology: 'random' | 'proximal' = 'random',
): Promise<number> {
    const res = await db.query<{ id: number }>(
        'INSERT INTO universes (name, seed, edit_id, topology) VALUES ($1, $2, $3, $4) RETURNING id',
        [name, seed, editId, topology],
    );
    return res.rows[0].id;
}

/** Fetch a universe's topology (defaults to 'random' for legacy rows). */
export async function getUniverseTopology(
    universeId: number,
    db: Queryable = pool,
): Promise<'random' | 'proximal'> {
    const res = await db.query<{ topology: string }>(
        'SELECT topology FROM universes WHERE id = $1',
        [universeId],
    );
    const t = res.rows[0]?.topology;
    return t === 'proximal' ? 'proximal' : 'random';
}

/** Rename an existing universe; returns undefined if not found. */
export async function renameUniverse(
    universeId: number,
    name: string,
    db: Queryable = pool,
): Promise<{ id: number; name: string } | undefined> {
    const res = await db.query<{ id: number; name: string }>(
        'UPDATE universes SET name = $1 WHERE id = $2 RETURNING id, name',
        [name, universeId],
    );
    return res.rows[0];
}

/** Delete a universe row (CASCADE clears dependent tables). */
export async function deleteUniverse(universeId: number, db: Queryable = pool): Promise<void> {
    await db.query('DELETE FROM universes WHERE id = $1', [universeId]);
}

/** Look up an edit by name; returns id (or null if not found). */
export async function getEditIdByName(name: string, db: Queryable = pool): Promise<number | null> {
    const res = await db.query<{ id: number }>('SELECT id FROM edits WHERE name = $1', [name]);
    return res.rows[0]?.id ?? null;
}

/** Earth starting colonists for an edit (falls back to 1,000,000). */
export async function getEarthStartingColonistsForEdit(
    editId: number | null,
    db: Queryable = pool,
): Promise<number> {
    if (editId === null) return 1_000_000;
    const res = await db.query<{ col: number }>(
        `SELECT COALESCE(e.starting_earth_colonists, 1000000) as col
         FROM edits e WHERE e.id = $1`,
        [editId],
    );
    return res.rows[0]?.col ?? 1_000_000;
}

/** New-player defaults for a universe (falls back to NULL if no edit). */
export type UniverseEditDefaults = {
    id: number;
    starting_turns: number | null;
    starting_credits: number | null;
    starting_ship: string | null;
    starting_drones: number | null;
};
export async function getUniverseEditDefaults(
    universeId: number,
    db: Queryable = pool,
): Promise<UniverseEditDefaults | undefined> {
    const res = await db.query<UniverseEditDefaults>(
        `SELECT u.id, e.starting_turns, e.starting_credits, e.starting_ship, e.starting_drones
         FROM universes u
         LEFT JOIN edits e ON u.edit_id = e.id
         WHERE u.id = $1`,
        [universeId],
    );
    return res.rows[0];
}

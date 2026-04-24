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

/**
 * Insert a NULL-named copy of the given template edit and return the new id.
 * Per-universe edit rows live alongside the named templates in the same
 * `edits` table; the NULL name flags them as snapshots that should never be
 * touched by the boot-time template-sync UPDATE.
 */
export async function cloneEditAsSnapshot(
    templateName: string,
    db: Queryable = pool,
): Promise<number | null> {
    const res = await db.query<{ id: number }>(
        `INSERT INTO edits (
            name,
            max_planets_per_sector,
            planet_collision_likelihood,
            planet_collision_min_hours,
            planet_collision_max_hours,
            turns_per_day,
            starting_turns,
            max_turns,
            starting_ship,
            starting_drones,
            starting_credits,
            starting_port_density,
            max_port_density,
            port_production_rate,
            port_memory_hours,
            max_players,
            max_age_days,
            max_planets,
            turn_delay,
            is_speed_warp_delay_on,
            photons_allowed,
            photon_blast_time_seconds,
            planet_spawn_density,
            max_ships_allowed,
            max_corp_size,
            max_ships_in_protected_space,
            truce_time_hours,
            is_automation_enabled
         )
         SELECT
            NULL,
            max_planets_per_sector,
            planet_collision_likelihood,
            planet_collision_min_hours,
            planet_collision_max_hours,
            turns_per_day,
            starting_turns,
            max_turns,
            starting_ship,
            starting_drones,
            starting_credits,
            starting_port_density,
            max_port_density,
            port_production_rate,
            port_memory_hours,
            max_players,
            max_age_days,
            max_planets,
            turn_delay,
            is_speed_warp_delay_on,
            photons_allowed,
            photon_blast_time_seconds,
            planet_spawn_density,
            max_ships_allowed,
            max_corp_size,
            max_ships_in_protected_space,
            truce_time_hours,
            is_automation_enabled
         FROM edits WHERE name = $1
         RETURNING id`,
        [templateName],
    );
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

/** Stats bundle for the in-game V (Starbase Info) screen. */
export type UniverseStatsRow = {
    name: string;
    created_at: Date;
    sector_count: number;
    port_count: number;
    max_planets_per_sector: number | null;
    starting_turns: number | null;
    starting_credits: number | null;
    starting_drones: number | null;
    starting_ship: string | null;
};
export async function getUniverseStats(
    universeId: number,
    db: Queryable = pool,
): Promise<UniverseStatsRow | undefined> {
    const res = await db.query<UniverseStatsRow>(
        `SELECT u.name, u.created_at,
                (SELECT COUNT(*)::int FROM sectors s WHERE s.universe_id = u.id) AS sector_count,
                (SELECT COUNT(*)::int FROM ports p
                   JOIN sectors s ON p.sector_id = s.id
                   WHERE s.universe_id = u.id) AS port_count,
                e.max_planets_per_sector,
                e.starting_turns, e.starting_credits, e.starting_drones, e.starting_ship
         FROM universes u
         LEFT JOIN edits e ON u.edit_id = e.id
         WHERE u.id = $1`,
        [universeId],
    );
    return res.rows[0];
}

/**
 * Out-warp degree distribution for a universe: how many sectors have
 * exactly N outgoing warps. Returned as a Map<degree, count>.
 */
export async function getOutWarpDegreeDistribution(
    universeId: number,
    db: Queryable = pool,
): Promise<Map<number, number>> {
    const res = await db.query<{ degree: number; count: number }>(
        `SELECT degree, COUNT(*)::int AS count FROM (
             SELECT s.id, COUNT(w.to_sector_id)::int AS degree
             FROM sectors s
             LEFT JOIN warps w ON w.from_sector_id = s.id
             WHERE s.universe_id = $1
             GROUP BY s.id
         ) t GROUP BY degree ORDER BY degree`,
        [universeId],
    );
    const out = new Map<number, number>();
    for (const r of res.rows) out.set(r.degree, r.count);
    return out;
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

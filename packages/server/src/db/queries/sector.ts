import { pool } from '../index.js';
import type { Queryable, CollisionRow, SectorNumberRow } from '../types.js';

export async function countSectorsInUniverse(
    universeId: number,
    db: Queryable = pool,
): Promise<number> {
    const res = await db.query<{ count: number }>(
        'SELECT COUNT(*)::int FROM sectors WHERE universe_id = $1',
        [universeId],
    );
    return res.rows[0]?.count ?? 0;
}

/** Look up which of the given sector numbers exist in a universe. */
export async function findSectorsByNumbers(
    sectorNumbers: number[],
    universeId: number,
    db: Queryable = pool,
): Promise<Set<number>> {
    if (sectorNumbers.length === 0) return new Set();
    const res = await db.query<SectorNumberRow>(
        'SELECT sector_number FROM sectors WHERE sector_number = ANY($1::int[]) AND universe_id = $2',
        [sectorNumbers, universeId],
    );
    return new Set(res.rows.map((r) => r.sector_number));
}

/** For a given set of sector numbers, return the subset the player has visited. */
export async function findVisitedSectorsInSet(
    playerId: number,
    universeId: number,
    sectorNumbers: number[],
    db: Queryable = pool,
): Promise<Set<number>> {
    if (sectorNumbers.length === 0) return new Set();
    const res = await db.query<SectorNumberRow>(
        `SELECT s.sector_number FROM player_visited_sectors vs
         JOIN sectors s ON vs.sector_id = s.id
         WHERE vs.player_id = $1 AND s.universe_id = $2
           AND s.sector_number = ANY($3::int[])`,
        [playerId, universeId, sectorNumbers],
    );
    return new Set(res.rows.map((r) => r.sector_number));
}

export async function getPlanetsInSector(
    sectorNumber: number,
    universeId: number,
): Promise<{ id: number; name: string; type: string; displayType: string | null }[]> {
    const res = await pool.query<{
        id: number;
        name: string;
        type: string;
        display_type: string | null;
    }>(
        `SELECT pl.id, pl.name, pl.type, pt.display_name AS display_type
         FROM planets pl
         JOIN sectors s ON pl.sector_id = s.id
         LEFT JOIN planet_types pt ON pt.slug = pl.type
         WHERE s.sector_number = $1 AND s.universe_id = $2 ORDER BY pl.id`,
        [sectorNumber, universeId],
    );
    return res.rows.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        displayType: r.display_type,
    }));
}

export async function getCollisionsInSector(
    sectorNumber: number,
    universeId: number,
): Promise<{ planetName: string; collidingWithName: string; collisionAt: string }[]> {
    const res = await pool.query<CollisionRow>(
        `SELECT p1.name as planet_name, p2.name as colliding_with_name, pc.collision_at
         FROM planet_collisions pc
         JOIN planets p1 ON pc.collision_planet = p1.id
         JOIN planets p2 ON pc.colliding_with = p2.id
         JOIN sectors s ON p1.sector_id = s.id
         WHERE s.sector_number = $1 AND s.universe_id = $2
           AND pc.collision_at > NOW()`,
        [sectorNumber, universeId],
    );
    return res.rows.map((r) => ({
        planetName: r.planet_name,
        collidingWithName: r.colliding_with_name,
        collisionAt: r.collision_at,
    }));
}

export async function getSectorDbId(
    sectorNumber: number,
    universeId: number,
): Promise<number | undefined> {
    const res = await pool.query(
        'SELECT id FROM sectors WHERE sector_number = $1 AND universe_id = $2',
        [sectorNumber, universeId],
    );
    return res.rows[0]?.id;
}

/** Return all sector numbers in a universe, ordered ascending. */
export async function listSectorNumbers(
    universeId: number,
    db: Queryable = pool,
): Promise<number[]> {
    const res = await db.query<{ sector_number: number }>(
        'SELECT sector_number FROM sectors WHERE universe_id = $1 ORDER BY sector_number ASC',
        [universeId],
    );
    return res.rows.map((r) => r.sector_number);
}

/** Return all warp edges (from, to) in a universe, as sector numbers. */
export async function listWarpEdges(
    universeId: number,
    db: Queryable = pool,
): Promise<{ from: number; to: number }[]> {
    const res = await db.query<{ sector_from: number; sector_to: number }>(
        `SELECT s_from.sector_number as sector_from, s_to.sector_number as sector_to
         FROM warps w
         JOIN sectors s_from ON w.from_sector_id = s_from.id
         JOIN sectors s_to ON w.to_sector_id = s_to.id
         WHERE s_from.universe_id = $1`,
        [universeId],
    );
    return res.rows.map((r) => ({ from: r.sector_from, to: r.sector_to }));
}

/** Insert a sector at universe-generation time; returns its id. */
export async function insertSector(
    universeId: number,
    sectorNumber: number,
    name: string,
    db: Queryable = pool,
    x: number | null = null,
    y: number | null = null,
): Promise<number> {
    const res = await db.query<{ id: number }>(
        'INSERT INTO sectors (universe_id, sector_number, name, x, y) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [universeId, sectorNumber, name, x, y],
    );
    return res.rows[0].id;
}

/** Insert a warp edge by internal sector ids (generation time). */
export async function insertWarp(
    fromSectorId: number,
    toSectorId: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query('INSERT INTO warps (from_sector_id, to_sector_id) VALUES ($1, $2)', [
        fromSectorId,
        toSectorId,
    ]);
}

/** Count warps in a universe (joined through sectors). */
export async function countWarpsInUniverse(
    universeId: number,
    db: Queryable = pool,
): Promise<number> {
    const res = await db.query<{ count: number }>(
        `SELECT COUNT(*)::int FROM warps w
         JOIN sectors s ON w.from_sector_id = s.id
         WHERE s.universe_id = $1`,
        [universeId],
    );
    return res.rows[0]?.count ?? 0;
}

/** Count total sectors across all universes (admin stats). */
export async function countAllSectors(db: Queryable = pool): Promise<number> {
    const res = await db.query<{ count: number }>('SELECT COUNT(*)::int FROM sectors');
    return res.rows[0]?.count ?? 0;
}

/** Sector number of the sector named 'Starbase' in a universe, if any. */
export async function getStarbaseSectorNumber(
    universeId: number,
    db: Queryable = pool,
): Promise<number | null> {
    const res = await db.query<{ sector_number: number }>(
        "SELECT sector_number FROM sectors WHERE name = 'Starbase' AND universe_id = $1 LIMIT 1",
        [universeId],
    );
    return res.rows[0]?.sector_number ?? null;
}

/** Warp destinations from a sector, each with a per-player visited flag. */
export async function getWarpRefsForPlayer(
    playerId: number,
    sectorNumber: number,
    universeId: number,
    db: Queryable = pool,
): Promise<{ sector: number; visited: boolean }[]> {
    const res = await db.query<{ sector_number: number; visited: boolean }>(
        `SELECT DISTINCT s_to.sector_number,
                (vs.player_id IS NOT NULL) AS visited
         FROM warps w
         JOIN sectors s_from ON w.from_sector_id = s_from.id
         JOIN sectors s_to   ON w.to_sector_id   = s_to.id
         LEFT JOIN player_visited_sectors vs ON vs.sector_id = s_to.id AND vs.player_id = $1
         WHERE s_from.sector_number = $2 AND s_from.universe_id = $3
         ORDER BY s_to.sector_number`,
        [playerId, sectorNumber, universeId],
    );
    return res.rows.map((r) => ({ sector: r.sector_number, visited: r.visited }));
}

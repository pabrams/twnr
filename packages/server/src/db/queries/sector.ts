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
        `SELECT s.sector_number FROM visited_sectors vs
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
): Promise<{ id: number; name: string; type: string }[]> {
    const res = await pool.query(
        `SELECT pl.id, pl.name, pl.type FROM planets pl
         JOIN sectors s ON pl.sector_id = s.id
         WHERE s.sector_number = $1 AND s.universe_id = $2 ORDER BY pl.id`,
        [sectorNumber, universeId],
    );
    return res.rows;
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

import { pool } from '../index.js';

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
    const res = await pool.query(
        `SELECT p1.name as planet_name, p2.name as colliding_with_name, pc.collision_at
         FROM planet_collisions pc
         JOIN planets p1 ON pc.collision_planet = p1.id
         JOIN planets p2 ON pc.colliding_with = p2.id
         JOIN sectors s ON p1.sector_id = s.id
         WHERE s.sector_number = $1 AND s.universe_id = $2
           AND pc.collision_at > NOW()`,
        [sectorNumber, universeId],
    );
    return res.rows.map((r: any) => ({
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

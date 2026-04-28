import { pool } from '../index.js';
import type { Queryable, PlayerPlanetRow } from '../types.js';
import { universeConfig } from '../../universe-config.js';

const COLONIST_COLUMN: Record<'fuel' | 'organics' | 'equipment', string> = {
    fuel: 'colonists_fuel',
    organics: 'colonists_organics',
    equipment: 'colonists_equipment',
};
export type ColonistCommodity = keyof typeof COLONIST_COLUMN;

export async function upsertEarthPlanet(sectorDbId: number, db: Queryable = pool): Promise<void> {
    await db.query(
        `INSERT INTO planets (sector_id, name, type) VALUES ($1, 'Earth', 'Terran') ON CONFLICT DO NOTHING`,
        [sectorDbId],
    );
}

export async function setEarthColonists(
    sectorDbId: number,
    colonists: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `UPDATE planets SET colonists_fuel = $1 WHERE sector_id = $2 AND name = 'Earth'`,
        [colonists, sectorDbId],
    );
}

export async function deletePlanet(planetId: number, db: Queryable = pool): Promise<void> {
    await db.query('DELETE FROM planets WHERE id = $1', [planetId]);
}

export async function getSectorByNumber(
    sectorNumber: number,
    universeId: number,
    db: Queryable = pool,
): Promise<{ id: number; name: string } | undefined> {
    const res = await db.query<{ id: number; name: string }>(
        'SELECT id, name FROM sectors WHERE sector_number = $1 AND universe_id = $2',
        [sectorNumber, universeId],
    );
    return res.rows[0];
}

/** Terraform/collision configuration resolved from a universe's edit. */
export type TerraformConfigRow = {
    max_planets_per_sector: number;
    planet_collision_likelihood: number;
    planet_collision_min_hours: number;
    planet_collision_max_hours: number;
};
export async function getTerraformConfigForUniverse(
    universeId: number,
    db: Queryable = pool,
): Promise<TerraformConfigRow | undefined> {
    const res = await db.query<TerraformConfigRow>(
        `SELECT COALESCE(us.max_planets_per_sector, ${universeConfig.maxPlanetsPerSector}) as max_planets_per_sector,
                COALESCE(us.planet_collision_likelihood, ${universeConfig.planetCollisionLikelihood}) as planet_collision_likelihood,
                COALESCE(us.planet_collision_min_hours, ${universeConfig.planetCollisionMinHours}) as planet_collision_min_hours,
                COALESCE(us.planet_collision_max_hours, ${universeConfig.planetCollisionMaxHours}) as planet_collision_max_hours
         FROM universes u LEFT JOIN universe_settings us ON us.universe_id = u.id WHERE u.id = $1`,
        [universeId],
    );
    return res.rows[0];
}

export async function getPlanetIdsInSectorForUpdate(
    sectorDbId: number,
    db: Queryable = pool,
): Promise<number[]> {
    const res = await db.query<{ id: number }>(
        'SELECT id FROM planets WHERE sector_id = $1 FOR UPDATE',
        [sectorDbId],
    );
    return res.rows.map((r) => r.id);
}

export async function insertPlanet(
    sectorDbId: number,
    name: string,
    type: string,
    ownerPlayerId: number,
    db: Queryable = pool,
): Promise<number> {
    const res = await db.query<{ id: number }>(
        'INSERT INTO planets (sector_id, name, type, owner_player_id) VALUES ($1, $2, $3, $4) RETURNING id',
        [sectorDbId, name, type, ownerPlayerId],
    );
    return res.rows[0].id;
}

export async function insertUnownedPlanet(
    sectorDbId: number,
    name: string,
    type: string,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `INSERT INTO planets (sector_id, name, type) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [sectorDbId, name, type],
    );
}

export async function insertPlanetCollision(
    collisionPlanetId: number,
    collidingWithId: number,
    hoursFromNow: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `INSERT INTO planet_collisions (collision_planet, colliding_with, collision_at)
         VALUES ($1, $2, NOW() + ($3::int * interval '1 hour'))`,
        [collisionPlanetId, collidingWithId, hoursFromNow],
    );
}

export async function getPlanetColonistsForUpdate(
    planetId: number,
    commodity: ColonistCommodity,
    db: Queryable = pool,
): Promise<number | undefined> {
    const col = COLONIST_COLUMN[commodity];
    const res = await db.query<{ available: number }>(
        `SELECT ${col} as available FROM planets WHERE id = $1 FOR UPDATE`,
        [planetId],
    );
    return res.rows[0]?.available;
}

export async function updatePlanetColonists(
    planetId: number,
    commodity: ColonistCommodity,
    delta: number,
    db: Queryable = pool,
): Promise<void> {
    const col = COLONIST_COLUMN[commodity];
    await db.query(`UPDATE planets SET ${col} = ${col} + $1 WHERE id = $2`, [delta, planetId]);
}

export async function getPlanetColonistsRemaining(
    planetId: number,
    commodity: ColonistCommodity,
    db: Queryable = pool,
): Promise<number | undefined> {
    const col = COLONIST_COLUMN[commodity];
    const res = await db.query<{ remaining: number }>(
        `SELECT ${col} as remaining FROM planets WHERE id = $1`,
        [planetId],
    );
    return res.rows[0]?.remaining;
}

export async function listPlayerPlanets(
    playerId: number,
    universeId: number,
    db: Queryable = pool,
): Promise<PlayerPlanetRow[]> {
    const res = await db.query<PlayerPlanetRow>(
        `SELECT p.id, s.sector_number, p.name, p.type,
                p.fuel, p.organics, p.equipment,
                p.colonists_fuel, p.colonists_organics, p.colonists_equipment
         FROM planets p
         JOIN sectors s ON p.sector_id = s.id
         WHERE p.owner_player_id = $1 AND s.universe_id = $2
         ORDER BY s.sector_number, p.id`,
        [playerId, universeId],
    );
    return res.rows;
}

export async function getEarthId(universeId: number): Promise<number | null> {
    const res = await pool.query(
        `SELECT pl.id FROM planets pl
         JOIN sectors s ON pl.sector_id = s.id
         WHERE s.sector_number = 1 AND s.universe_id = $1 AND pl.name = 'Earth'
         LIMIT 1`,
        [universeId],
    );
    return res.rows[0]?.id ?? null;
}

export async function getPlanetInSector(
    planetId: number,
    sectorNumber: number,
    universeId: number,
): Promise<any | null> {
    const res = await pool.query(
        `SELECT pl.* FROM planets pl
         JOIN sectors s ON pl.sector_id = s.id
         WHERE pl.id = $1 AND s.sector_number = $2 AND s.universe_id = $3`,
        [planetId, sectorNumber, universeId],
    );
    return res.rows[0] ?? null;
}

export async function getPlanetDisplayData(playerId: number): Promise<{
    id: number;
    sector_id: number;
    name: string;
    planetType: string;
    drones: number;
    fuel: number;
    organics: number;
    equipment: number;
    colonists_fuel: number;
    colonists_organics: number;
    colonists_equipment: number;
    created_at: Date;
    updated_at: Date | null;
} | null> {
    const playerRes = await pool.query('SELECT on_planet_id FROM players WHERE id = $1', [
        playerId,
    ]);
    const onPlanetId = playerRes.rows[0]?.on_planet_id;
    if (!onPlanetId) return null;

    const planetRes = await pool.query(
        'SELECT id, sector_id, name, type, drones, fuel, organics, equipment, colonists_fuel, colonists_organics, colonists_equipment, created_at, updated_at FROM planets WHERE id = $1',
        [onPlanetId],
    );
    if (planetRes.rows.length === 0) return null;

    const { type: planetType, ...rest } = planetRes.rows[0];
    return { planetType, ...rest };
}

export async function getPlanetName(planetId: number): Promise<string | null> {
    const res = await pool.query('SELECT name FROM planets WHERE id = $1', [planetId]);
    return res.rows[0]?.name ?? null;
}

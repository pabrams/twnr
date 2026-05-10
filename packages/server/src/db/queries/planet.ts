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

const COLONIST_MAX_COLUMN: Record<ColonistCommodity, string> = {
    fuel: 'max_fuel_colos',
    organics: 'max_org_colos',
    equipment: 'max_equ_colos',
};

/** Per-commodity colonist cap from planet_types, plus the planet's current
 *  count for that commodity. Used to clamp leave_colonists requests to
 *  what the planet can still hold. */
export async function getPlanetColonistsCapacity(
    planetId: number,
    commodity: ColonistCommodity,
    db: Queryable = pool,
): Promise<{ current: number; max: number } | undefined> {
    const col = COLONIST_COLUMN[commodity];
    const maxCol = COLONIST_MAX_COLUMN[commodity];
    const res = await db.query<{ current: number; max: number }>(
        `SELECT p.${col} as current, pt.${maxCol} as max
         FROM planets p
         JOIN planet_types pt ON pt.name = p.type
         WHERE p.id = $1`,
        [planetId],
    );
    return res.rows[0];
}

const COMMODITY_COLUMN: Record<'fuel' | 'organics' | 'equipment', string> = {
    fuel: 'fuel',
    organics: 'organics',
    equipment: 'equipment',
};
export type PlanetCommodity = keyof typeof COMMODITY_COLUMN;

const COMMODITY_MAX_COLUMN: Record<PlanetCommodity, string> = {
    fuel: 'max_fuel',
    organics: 'max_org',
    equipment: 'max_equ',
};

export async function getPlanetCommodityForUpdate(
    planetId: number,
    commodity: PlanetCommodity,
    db: Queryable = pool,
): Promise<number | undefined> {
    const col = COMMODITY_COLUMN[commodity];
    const res = await db.query<{ available: number }>(
        `SELECT ${col} as available FROM planets WHERE id = $1 FOR UPDATE`,
        [planetId],
    );
    return res.rows[0]?.available;
}

export async function updatePlanetCommodity(
    planetId: number,
    commodity: PlanetCommodity,
    delta: number,
    db: Queryable = pool,
): Promise<void> {
    const col = COMMODITY_COLUMN[commodity];
    await db.query(`UPDATE planets SET ${col} = ${col} + $1 WHERE id = $2`, [delta, planetId]);
}

export async function getPlanetCommodityRemaining(
    planetId: number,
    commodity: PlanetCommodity,
    db: Queryable = pool,
): Promise<number | undefined> {
    const col = COMMODITY_COLUMN[commodity];
    const res = await db.query<{ remaining: number }>(
        `SELECT ${col} as remaining FROM planets WHERE id = $1`,
        [planetId],
    );
    return res.rows[0]?.remaining;
}

/** Per-commodity quantity cap from planet_types, plus the planet's current
 *  stockpile. Used to clamp leave_commodity to the room remaining. */
export async function getPlanetCommodityCapacity(
    planetId: number,
    commodity: PlanetCommodity,
    db: Queryable = pool,
): Promise<{ current: number; max: number } | undefined> {
    const col = COMMODITY_COLUMN[commodity];
    const maxCol = COMMODITY_MAX_COLUMN[commodity];
    const res = await db.query<{ current: number; max: number }>(
        `SELECT p.${col} as current, pt.${maxCol} as max
         FROM planets p
         JOIN planet_types pt ON pt.name = p.type
         WHERE p.id = $1`,
        [planetId],
    );
    return res.rows[0];
}

export async function listPlayerPlanets(
    playerId: number,
    universeId: number,
    db: Queryable = pool,
): Promise<PlayerPlanetRow[]> {
    const res = await db.query<PlayerPlanetRow>(
        `SELECT p.id, s.sector_number, p.name, p.type, pt.display_name AS display_type,
                p.fuel, p.organics, p.equipment,
                p.colonists_fuel, p.colonists_organics, p.colonists_equipment
         FROM planets p
         JOIN sectors s ON p.sector_id = s.id
         LEFT JOIN planet_types pt ON pt.name = p.type
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
): Promise<{ id: number; name: string } | null> {
    const res = await pool.query<{ id: number; name: string }>(
        `SELECT pl.id, pl.name FROM planets pl
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
    displayType: string | null;
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
        `SELECT pl.id, pl.sector_id, pl.name, pl.type, pt.display_name AS display_type,
                pl.drones, pl.fuel, pl.organics, pl.equipment,
                pl.colonists_fuel, pl.colonists_organics, pl.colonists_equipment,
                pl.created_at, pl.updated_at
         FROM planets pl
         LEFT JOIN planet_types pt ON pt.name = pl.type
         WHERE pl.id = $1`,
        [onPlanetId],
    );
    if (planetRes.rows.length === 0) return null;

    const { type: planetType, display_type: displayType, ...rest } = planetRes.rows[0];
    return { planetType, displayType, ...rest };
}

export async function getPlanetName(planetId: number): Promise<string | null> {
    const res = await pool.query('SELECT name FROM planets WHERE id = $1', [planetId]);
    return res.rows[0]?.name ?? null;
}

/** Settle accrued production on a single planet. Reads the planet's current
 *  state (colos, stockpiles, last_production_at) plus the joined planet_type
 *  and universe_setting rows, then applies
 *  `floor(colos * production_rate * elapsed_hours / colos_per_unit)` per
 *  commodity (clamped to the type's max stockpile) and stamps
 *  last_production_at = NOW().
 *
 *  Always stamps, so callers that are about to mutate colos (take/leave
 *  colonists) should call this first — the segment up to "now" is credited
 *  against the *old* colos count, and the next segment starts fresh against
 *  the new count. Sub-unit fractional accrual at segment boundaries is
 *  rounded down (intentional trade-off for not carrying fractional state).
 *            
 *  Locks the planet row FOR UPDATE; safe to call from a transaction that
 *  later re-locks the same row. */
const ONE_HOUR_MS = 60 * 60 * 1000;
export async function settlePlanetProduction(
    planetId: number,
    db: Queryable = pool,
): Promise<{ produced: boolean }> {
    const res = await db.query<{
        fuel: number;
        organics: number;
        equipment: number;
        colonists_fuel: number;
        colonists_organics: number;
        colonists_equipment: number;
        fuel_production: number;
        organics_production: number;
        equipment_production: number;
        max_fuel: number;
        max_org: number;
        max_equ: number;
        last_production_at: Date;
        colos_per_unit: number;
    }>(
        `SELECT p.fuel, p.organics, p.equipment,
                p.colonists_fuel, p.colonists_organics, p.colonists_equipment,
                pt.fuel_production, pt.organics_production, pt.equipment_production,
                pt.max_fuel, pt.max_org, pt.max_equ,
                p.last_production_at,
                COALESCE(us.colos_to_produce_one_unit_per_hour, ${universeConfig.colosToProduceOneUnitPerHour}) AS colos_per_unit
         FROM planets p
         JOIN sectors s ON p.sector_id = s.id
         JOIN planet_types pt ON pt.name = p.type
         LEFT JOIN universe_settings us ON us.universe_id = s.universe_id
         WHERE p.id = $1
         FOR UPDATE OF p`,
        [planetId],
    );
    const row = res.rows[0];
    if (!row) return { produced: false };

    const cpu = row.colos_per_unit;
    if (cpu <= 0) return { produced: false };

    const elapsedMs = Date.now() - new Date(row.last_production_at).getTime();
    if (elapsedMs <= 0) return { produced: false };
    const elapsedHours = elapsedMs / ONE_HOUR_MS;

    const dFuel = Math.floor((row.colonists_fuel * row.fuel_production * elapsedHours) / cpu);
    const dOrg = Math.floor((row.colonists_organics * row.organics_production * elapsedHours) / cpu);
    const dEqu = Math.floor((row.colonists_equipment * row.equipment_production * elapsedHours) / cpu);

    const newFuel = Math.min(row.max_fuel, row.fuel + dFuel);
    const newOrg = Math.min(row.max_org, row.organics + dOrg);
    const newEqu = Math.min(row.max_equ, row.equipment + dEqu);

    await db.query(
        `UPDATE planets
         SET fuel = $2, organics = $3, equipment = $4, last_production_at = NOW()
         WHERE id = $1`,
        [planetId, newFuel, newOrg, newEqu],
    );
    const produced = newFuel !== row.fuel || newOrg !== row.organics || newEqu !== row.equipment;
    return { produced };
}

/** IDs of every planet that currently has any colonists assigned to a
 *  commodity. The hourly job iterates these and calls settle per-planet —
 *  planets with all-zero colos can't produce anything so they're skipped
 *  at the list level instead of being locked for nothing. */
export async function listPlanetIdsWithColonists(db: Queryable = pool): Promise<number[]> {
    const res = await db.query<{ id: number }>(
        `SELECT id FROM planets
         WHERE colonists_fuel > 0 OR colonists_organics > 0 OR colonists_equipment > 0`,
    );
    return res.rows.map((r) => r.id);
}

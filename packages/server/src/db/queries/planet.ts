import { pool } from '../index.js';
import type { Queryable, PlayerPlanetRow } from '../types.js';
import { universeConfig } from '@twnr/shared';

const COLONIST_COLUMN: Record<'fuel' | 'organics' | 'equipment', string> = {
    fuel: 'colonists_fuel',
    organics: 'colonists_organics',
    equipment: 'colonists_equipment',
};
export type ColonistCommodity = keyof typeof COLONIST_COLUMN;

export async function upsertEarthPlanet(sectorDbId: number, db: Queryable = pool): Promise<void> {
    await db.query(
        `INSERT INTO planets (sector_id, universe_id, universe_planet_number, name, type)
         SELECT s.id, s.universe_id,
                COALESCE((SELECT MAX(universe_planet_number) FROM planets WHERE universe_id = s.universe_id), 0) + 1,
                'Earth', 'Terran'
         FROM sectors s WHERE s.id = $1
         ON CONFLICT DO NOTHING`,
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
    await clearPlayersOnPlanet(planetId, db);
    await db.query('DELETE FROM planets WHERE id = $1', [planetId]);
}

export async function clearPlayersOnPlanet(planetId: number, db: Queryable = pool): Promise<void> {
    await db.query('UPDATE players SET on_planet_id = NULL WHERE on_planet_id = $1', [planetId]);
}

export async function setPlanetOwnership(
    planetId: number,
    ownerPlayerId: number | null,
    ownerClanId: number | null,
    db: Queryable = pool,
): Promise<void> {
    await db.query('UPDATE planets SET owner_player_id = $1, owner_clan_id = $2 WHERE id = $3', [
        ownerPlayerId,
        ownerClanId,
        planetId,
    ]);
}

export async function setPlanetName(
    planetId: number,
    name: string,
    db: Queryable = pool,
): Promise<void> {
    await db.query('UPDATE planets SET name = $1 WHERE id = $2', [name, planetId]);
}

export async function getPlanetOwnerPlayerId(
    planetId: number,
    db: Queryable = pool,
): Promise<number | null | undefined> {
    const res = await db.query<{ owner_player_id: number | null }>(
        'SELECT owner_player_id FROM planets WHERE id = $1',
        [planetId],
    );
    return res.rows[0]?.owner_player_id;
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
        `INSERT INTO planets (sector_id, universe_id, universe_planet_number, name, type, owner_player_id)
         SELECT s.id, s.universe_id,
                COALESCE((SELECT MAX(universe_planet_number) FROM planets WHERE universe_id = s.universe_id), 0) + 1,
                $2, $3, $4
         FROM sectors s WHERE s.id = $1
         RETURNING id`,
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
        `INSERT INTO planets (sector_id, universe_id, universe_planet_number, name, type)
         SELECT s.id, s.universe_id,
                COALESCE((SELECT MAX(universe_planet_number) FROM planets WHERE universe_id = s.universe_id), 0) + 1,
                $2, $3
         FROM sectors s WHERE s.id = $1
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
         JOIN universe_planet_types pt ON pt.universe_id = p.universe_id AND pt.slug = p.type
         WHERE p.id = $1`,
        [planetId],
    );
    return res.rows[0];
}

const COMMODITY_COLUMN: Record<'fuel' | 'organics' | 'equipment' | 'drones', string> = {
    fuel: 'fuel',
    organics: 'organics',
    equipment: 'equipment',
    drones: 'drones',
};
export type PlanetCommodity = keyof typeof COMMODITY_COLUMN;

const COMMODITY_MAX_COLUMN: Record<PlanetCommodity, string> = {
    fuel: 'max_fuel',
    organics: 'max_org',
    equipment: 'max_equ',
    drones: 'max_drones',
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
         JOIN universe_planet_types pt ON pt.universe_id = p.universe_id AND pt.slug = p.type
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
                p.drones, p.fuel, p.organics, p.equipment,
                p.colonists_fuel, p.colonists_organics, p.colonists_equipment
         FROM planets p
         JOIN sectors s ON p.sector_id = s.id
         LEFT JOIN universe_planet_types pt ON pt.universe_id = p.universe_id AND pt.slug = p.type
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
    universe_planet_number: number;
    sector_id: number;
    name: string;
    planetType: string;
    displayType: string | null;
    owner_name: string | null;
    drones: number;
    fuel: number;
    organics: number;
    equipment: number;
    colonists_fuel: number;
    colonists_organics: number;
    colonists_equipment: number;
    fuel_production: number;
    organics_production: number;
    equipment_production: number;
    fig_factor_fuel: number;
    fig_factor_org: number;
    fig_factor_equ: number;
    max_fuel: number;
    max_org: number;
    max_equ: number;
    max_drones: number;
    max_fuel_colos: number;
    max_org_colos: number;
    max_equ_colos: number;
    colos_per_unit_per_hour: number;
    base_level: number | null;
    base_treasury: number | null;
    base_transporter_range: number | null;
    base_construction_target_level: number | null;
    base_construction_completes_at: string | null;
    created_at: string;
    updated_at: string | null;
} | null> {
    const playerRes = await pool.query('SELECT on_planet_id FROM players WHERE id = $1', [
        playerId,
    ]);
    const onPlanetId = playerRes.rows[0]?.on_planet_id;
    if (!onPlanetId) return null;

    await getPlanetBase(onPlanetId);

    const planetRes = await pool.query(
        `SELECT pl.id, pl.universe_planet_number, pl.sector_id, pl.name, pl.type, pt.display_name AS display_type,
                pl.owner_player_id, pl.owner_clan_id,
                owner.name AS owner_player_name,
                oc.name AS owner_clan_name,
                oc.universe_clan_number AS owner_clan_number,
                pl.drones, pl.fuel, pl.organics, pl.equipment,
                pl.colonists_fuel, pl.colonists_organics, pl.colonists_equipment,
                pt.fuel_production, pt.organics_production, pt.equipment_production,
                pt.fig_factor_fuel, pt.fig_factor_org, pt.fig_factor_equ,
                pt.max_fuel, pt.max_org, pt.max_equ, pt.max_drones,
                pt.max_fuel_colos, pt.max_org_colos, pt.max_equ_colos,
                COALESCE(us.colos_to_produce_one_unit_per_hour, ${universeConfig.colosToProduceOneUnitPerHour}) AS colos_per_unit_per_hour,
                pb.level AS base_level,
                pb.treasury::int AS base_treasury,
                pb.transporter_range AS base_transporter_range,
                pb.construction_target_level AS base_construction_target_level,
                pb.construction_completes_at AS base_construction_completes_at,
                pl.created_at, pl.updated_at
         FROM planets pl
         JOIN sectors s ON s.id = pl.sector_id
         LEFT JOIN universe_planet_types pt ON pt.universe_id = pl.universe_id AND pt.slug = pl.type
         LEFT JOIN universe_settings us ON us.universe_id = s.universe_id
         LEFT JOIN players owner ON owner.id = pl.owner_player_id
         LEFT JOIN clans oc ON oc.id = pl.owner_clan_id
         LEFT JOIN planet_bases pb ON pb.planet_id = pl.id
         WHERE pl.id = $1`,
        [onPlanetId],
    );
    if (planetRes.rows.length === 0) return null;

    const row = planetRes.rows[0];
    const { formatOwner } = await import('../../services/owner-format.js');
    const owner_name = formatOwner(row);
    const toIso = (d: Date | null | undefined): string | null =>
        d instanceof Date ? d.toISOString() : (d ?? null);
    const {
        type: planetType,
        display_type: displayType,
        ...rest
    } = {
        ...row,
        owner_name,
        base_construction_completes_at: toIso(row.base_construction_completes_at),
        created_at: row.created_at.toISOString(),
        updated_at: toIso(row.updated_at),
    };
    return { planetType, displayType, ...rest };
}

export async function getPlanetName(planetId: number): Promise<string | null> {
    const res = await pool.query('SELECT name FROM planets WHERE id = $1', [planetId]);
    return res.rows[0]?.name ?? null;
}

export type PlanetOwnershipRow = {
    name: string;
    sector_number: number;
    owner_player_id: number | null;
    owner_clan_id: number | null;
};

export async function getPlanetOwnership(planetId: number): Promise<PlanetOwnershipRow | null> {
    const res = await pool.query<PlanetOwnershipRow>(
        `SELECT pl.name, s.sector_number, pl.owner_player_id, pl.owner_clan_id
         FROM planets pl
         JOIN sectors s ON s.id = pl.sector_id
         WHERE pl.id = $1`,
        [planetId],
    );
    return res.rows[0] ?? null;
}

const ONE_HOUR_MS = 60 * 60 * 1000;

/** Production above max is discarded, never banked in the accrual. */
export async function settlePlanetProduction(
    planetId: number,
    db: Queryable = pool,
): Promise<{ produced: boolean }> {
    const res = await db.query<{
        fuel: number;
        organics: number;
        equipment: number;
        drones: number;
        colonists_fuel: number;
        colonists_organics: number;
        colonists_equipment: number;
        fuel_production: number;
        organics_production: number;
        equipment_production: number;
        fig_factor_fuel: number;
        fig_factor_org: number;
        fig_factor_equ: number;
        max_fuel: number;
        max_org: number;
        max_equ: number;
        max_drones: number;
        last_production_at: Date;
        colos_per_unit: number;
        fuel_production_accrual: number;
        org_production_accrual: number;
        equ_production_accrual: number;
        drn_production_accrual: number;
    }>(
        `SELECT p.fuel, p.organics, p.equipment, p.drones,
                p.colonists_fuel, p.colonists_organics, p.colonists_equipment,
                pt.fuel_production, pt.organics_production, pt.equipment_production,
                pt.fig_factor_fuel, pt.fig_factor_org, pt.fig_factor_equ,
                pt.max_fuel, pt.max_org, pt.max_equ, pt.max_drones,
                p.last_production_at,
                p.fuel_production_accrual, p.org_production_accrual, p.equ_production_accrual,
                p.drn_production_accrual,
                COALESCE(us.colos_to_produce_one_unit_per_hour, ${universeConfig.colosToProduceOneUnitPerHour}) AS colos_per_unit
         FROM planets p
         JOIN sectors s ON p.sector_id = s.id
         JOIN universe_planet_types pt ON pt.universe_id = p.universe_id AND pt.slug = p.type
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

    const settle = (
        stock: number,
        max: number,
        colos: number,
        prodRate: number,
        accrual: number,
    ): { stock: number; accrual: number } => {
        const newAccrual = accrual + (colos * prodRate * elapsedHours) / cpu;
        const whole = Math.floor(newAccrual);
        const newStock = Math.min(max, stock + whole);
        return { stock: newStock, accrual: newAccrual - whole };
    };

    const fuel = settle(
        row.fuel,
        row.max_fuel,
        row.colonists_fuel,
        row.fuel_production,
        row.fuel_production_accrual,
    );
    const org = settle(
        row.organics,
        row.max_org,
        row.colonists_organics,
        row.organics_production,
        row.org_production_accrual,
    );
    const equ = settle(
        row.equipment,
        row.max_equ,
        row.colonists_equipment,
        row.equipment_production,
        row.equ_production_accrual,
    );

    const dronesPerHour =
        (row.fig_factor_fuel > 0 ? row.colonists_fuel / row.fig_factor_fuel : 0) +
        (row.fig_factor_org > 0 ? row.colonists_organics / row.fig_factor_org : 0) +
        (row.fig_factor_equ > 0 ? row.colonists_equipment / row.fig_factor_equ : 0);
    const newDrnAccrual = row.drn_production_accrual + dronesPerHour * elapsedHours;
    const wholeDrones = Math.floor(newDrnAccrual);
    const drn = {
        stock: Math.min(row.max_drones, row.drones + wholeDrones),
        accrual: newDrnAccrual - wholeDrones,
    };

    const produced =
        fuel.stock !== row.fuel ||
        org.stock !== row.organics ||
        equ.stock !== row.equipment ||
        drn.stock !== row.drones;

    await db.query(
        `UPDATE planets SET
            fuel = $2, organics = $3, equipment = $4, drones = $5,
            fuel_production_accrual = $6,
            org_production_accrual = $7,
            equ_production_accrual = $8,
            drn_production_accrual = $9,
            last_production_at = NOW()
         WHERE id = $1`,
        [
            planetId,
            fuel.stock,
            org.stock,
            equ.stock,
            drn.stock,
            fuel.accrual,
            org.accrual,
            equ.accrual,
            drn.accrual,
        ],
    );
    return { produced };
}

/** Births and deaths accrue separately to avoid cancellation loss; growth above max is discarded, never banked. */
export async function settlePlanetColonistGrowth(
    planetId: number,
    db: Queryable = pool,
): Promise<{ changed: boolean }> {
    const res = await db.query<{
        colonists_fuel: number;
        colonists_organics: number;
        colonists_equipment: number;
        max_fuel_colos: number;
        max_org_colos: number;
        max_equ_colos: number;
        danger: number;
        last_colonist_event_at: Date;
        rate_per_1000: number;
        fuel_birth_accrual: number;
        org_birth_accrual: number;
        equ_birth_accrual: number;
        fuel_death_accrual: number;
        org_death_accrual: number;
        equ_death_accrual: number;
    }>(
        `SELECT p.colonists_fuel, p.colonists_organics, p.colonists_equipment,
                pt.max_fuel_colos, pt.max_org_colos, pt.max_equ_colos,
                pt.danger,
                p.last_colonist_event_at,
                p.fuel_birth_accrual, p.org_birth_accrual, p.equ_birth_accrual,
                p.fuel_death_accrual, p.org_death_accrual, p.equ_death_accrual,
                COALESCE(us.daily_reproduction_per_1000_colos, ${universeConfig.dailyReproductionPer1000Colos}) AS rate_per_1000
         FROM planets p
         JOIN sectors s ON p.sector_id = s.id
         JOIN universe_planet_types pt ON pt.universe_id = p.universe_id AND pt.slug = p.type
         LEFT JOIN universe_settings us ON us.universe_id = s.universe_id
         WHERE p.id = $1
         FOR UPDATE OF p`,
        [planetId],
    );
    const row = res.rows[0];
    if (!row) return { changed: false };

    const elapsedMs = Date.now() - new Date(row.last_colonist_event_at).getTime();
    if (elapsedMs <= 0) return { changed: false };
    const elapsedDays = elapsedMs / (24 * 60 * 60 * 1000);
    const rate = row.rate_per_1000;
    const danger = row.danger;

    const settle = (
        colos: number,
        max: number,
        birthAccrual: number,
        deathAccrual: number,
    ): { colos: number; birthAccrual: number; deathAccrual: number } => {
        const newBirth = birthAccrual + (colos * rate * elapsedDays) / 1000;
        const newDeath = deathAccrual + (colos * danger * elapsedDays) / 1000;
        const wholeBirths = Math.floor(newBirth);
        const wholeDeaths = Math.floor(newDeath);
        const newColos = Math.max(0, Math.min(max, colos + wholeBirths - wholeDeaths));
        return {
            colos: newColos,
            birthAccrual: newBirth - wholeBirths,
            deathAccrual: newDeath - wholeDeaths,
        };
    };

    const fuel = settle(
        row.colonists_fuel,
        row.max_fuel_colos,
        row.fuel_birth_accrual,
        row.fuel_death_accrual,
    );
    const org = settle(
        row.colonists_organics,
        row.max_org_colos,
        row.org_birth_accrual,
        row.org_death_accrual,
    );
    const equ = settle(
        row.colonists_equipment,
        row.max_equ_colos,
        row.equ_birth_accrual,
        row.equ_death_accrual,
    );

    const changed =
        fuel.colos !== row.colonists_fuel ||
        org.colos !== row.colonists_organics ||
        equ.colos !== row.colonists_equipment;

    await db.query(
        `UPDATE planets SET
            colonists_fuel = $2, colonists_organics = $3, colonists_equipment = $4,
            fuel_birth_accrual = $5, org_birth_accrual = $6, equ_birth_accrual = $7,
            fuel_death_accrual = $8, org_death_accrual = $9, equ_death_accrual = $10,
            last_colonist_event_at = NOW()
         WHERE id = $1`,
        [
            planetId,
            fuel.colos,
            org.colos,
            equ.colos,
            fuel.birthAccrual,
            org.birthAccrual,
            equ.birthAccrual,
            fuel.deathAccrual,
            org.deathAccrual,
            equ.deathAccrual,
        ],
    );
    return { changed };
}

export async function listPlanetIdsWithColonists(db: Queryable = pool): Promise<number[]> {
    const res = await db.query<{ id: number }>(
        `SELECT id FROM planets
         WHERE colonists_fuel > 0
            OR colonists_organics > 0
            OR colonists_equipment > 0`,
    );
    return res.rows.map((r) => r.id);
}

export type PlanetBaseRow = {
    level: number;
    treasury: number;
    transporter_range: number;
    construction_target_level: number | null;
    construction_started_at: Date | null;
    construction_completes_at: Date | null;
};

/** Side effect: completes any due construction (level := target, construction fields cleared) before reading. */
export async function getPlanetBase(
    planetId: number,
    db: Queryable = pool,
): Promise<PlanetBaseRow | null> {
    const promoted = await db.query<PlanetBaseRow>(
        `UPDATE planet_bases
         SET level = construction_target_level,
             construction_target_level = NULL,
             construction_started_at = NULL,
             construction_completes_at = NULL
         WHERE planet_id = $1
           AND construction_target_level IS NOT NULL
           AND construction_completes_at <= NOW()
         RETURNING level, treasury::int AS treasury, transporter_range,
                   construction_target_level, construction_started_at,
                   construction_completes_at`,
        [planetId],
    );
    if (promoted.rows[0]) return promoted.rows[0];
    const res = await db.query<PlanetBaseRow>(
        `SELECT level, treasury::int AS treasury, transporter_range,
                construction_target_level, construction_started_at,
                construction_completes_at
         FROM planet_bases WHERE planet_id = $1`,
        [planetId],
    );
    return res.rows[0] ?? null;
}

export async function promoteDuePlanetBases(db: Queryable = pool): Promise<number> {
    const res = await db.query<{ planet_id: number }>(
        `UPDATE planet_bases
         SET level = construction_target_level,
             construction_target_level = NULL,
             construction_started_at = NULL,
             construction_completes_at = NULL
         WHERE construction_target_level IS NOT NULL
           AND construction_completes_at <= NOW()
         RETURNING planet_id`,
        [],
    );
    return res.rows.length;
}

export async function getPlanetBaseTreasuryForUpdate(
    planetId: number,
    db: Queryable = pool,
): Promise<{ level: number; treasury: number } | null> {
    const res = await db.query<{ level: number; treasury: number }>(
        `SELECT level, treasury::int AS treasury
         FROM planet_bases WHERE planet_id = $1 FOR UPDATE`,
        [planetId],
    );
    return res.rows[0] ?? null;
}

export async function adjustPlanetBaseTreasury(
    planetId: number,
    delta: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query(`UPDATE planet_bases SET treasury = treasury + $1 WHERE planet_id = $2`, [
        delta,
        planetId,
    ]);
}

export async function getPlanetBaseTransporterForUpdate(
    planetId: number,
    db: Queryable = pool,
): Promise<{ level: number; transporter_range: number; treasury: number } | null> {
    const res = await db.query<{ level: number; transporter_range: number; treasury: number }>(
        `SELECT level, transporter_range, treasury::int AS treasury
         FROM planet_bases WHERE planet_id = $1 FOR UPDATE`,
        [planetId],
    );
    return res.rows[0] ?? null;
}

export async function setPlanetBaseTransporterRange(
    planetId: number,
    range: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query(`UPDATE planet_bases SET transporter_range = $1 WHERE planet_id = $2`, [
        range,
        planetId,
    ]);
}

export async function getPlanetFuelForUpdate(
    planetId: number,
    db: Queryable = pool,
): Promise<number | undefined> {
    const res = await db.query<{ fuel: number }>(
        `SELECT fuel FROM planets WHERE id = $1 FOR UPDATE`,
        [planetId],
    );
    return res.rows[0]?.fuel;
}

export async function insertPlanetBaseConstruction(
    planetId: number,
    targetLevel: number,
    daysRequired: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `INSERT INTO planet_bases (
            planet_id, level, construction_target_level,
            construction_started_at, construction_completes_at
         ) VALUES (
            $1, 0, $2,
            NOW(), NOW() + ($3::int * INTERVAL '1 day')
         )`,
        [planetId, targetLevel, daysRequired],
    );
}

export async function getPlanetTotalColonists(
    planetId: number,
    db: Queryable = pool,
): Promise<number> {
    const res = await db.query<{ total: number }>(
        `SELECT (colonists_fuel + colonists_organics + colonists_equipment)::int AS total
         FROM planets WHERE id = $1`,
        [planetId],
    );
    return res.rows[0]?.total ?? 0;
}

export type PlanetClassInfo = {
    class: string;
    base_requirements: unknown[];
    display_name: string | null;
    slug: string;
};

export async function getPlanetClassInfo(
    planetId: number,
    db: Queryable = pool,
): Promise<PlanetClassInfo | null> {
    const res = await db.query<PlanetClassInfo>(
        `SELECT pt.class, pt.base_requirements, pt.display_name, pt.slug
         FROM planets p
         JOIN universe_planet_types pt
              ON pt.universe_id = p.universe_id AND pt.slug = p.type
         WHERE p.id = $1`,
        [planetId],
    );
    return res.rows[0] ?? null;
}

export async function getPlanetCommodityStockForUpdate(
    planetId: number,
    db: Queryable = pool,
): Promise<{ fuel: number; organics: number; equipment: number } | null> {
    const res = await db.query<{ fuel: number; organics: number; equipment: number }>(
        `SELECT fuel, organics, equipment FROM planets WHERE id = $1 FOR UPDATE`,
        [planetId],
    );
    return res.rows[0] ?? null;
}

export async function getPlanetStock(
    planetId: number,
    db: Queryable = pool,
): Promise<{ fuel: number; organics: number; equipment: number }> {
    const res = await db.query<{ fuel: number; organics: number; equipment: number }>(
        'SELECT fuel, organics, equipment FROM planets WHERE id = $1',
        [planetId],
    );
    return res.rows[0] ?? { fuel: 0, organics: 0, equipment: 0 };
}

export async function getPlanetFuel(planetId: number, db: Queryable = pool): Promise<number> {
    const res = await db.query<{ fuel: number }>('SELECT fuel FROM planets WHERE id = $1', [
        planetId,
    ]);
    return res.rows[0]?.fuel ?? 0;
}

export type PlanetCatalogRow = {
    slug: string;
    display_name: string | null;
    description: string | null;
    class: string;
    danger: number;
    max_fuel_colos: number;
    max_org_colos: number;
    max_equ_colos: number;
    max_fuel: number;
    max_org: number;
    max_equ: number;
    max_drones: number;
    max_citadel: number;
    fuel_production: number;
    organics_production: number;
    equipment_production: number;
    fig_factor_fuel: number;
    fig_factor_org: number;
    fig_factor_equ: number;
};

export async function listUniversePlanetTypes(
    universeId: number,
    db: Queryable = pool,
): Promise<PlanetCatalogRow[]> {
    const res = await db.query<PlanetCatalogRow>(
        `SELECT slug, display_name, description, class, danger,
                max_fuel_colos, max_org_colos, max_equ_colos,
                max_fuel, max_org, max_equ, max_drones, max_citadel,
                fuel_production, organics_production, equipment_production,
                fig_factor_fuel, fig_factor_org, fig_factor_equ
         FROM universe_planet_types
         WHERE universe_id = $1
         ORDER BY slug`,
        [universeId],
    );
    return res.rows;
}

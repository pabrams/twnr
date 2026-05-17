import { universeConfig } from '@twnr/shared';
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

/** Lowest-id universe (the "first" one). null if none exist. */
export async function getFirstUniverseId(db: Queryable = pool): Promise<number | null> {
    const res = await db.query<{ id: number }>('SELECT id FROM universes ORDER BY id ASC LIMIT 1');
    return res.rows[0]?.id ?? null;
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

/** Create a universe at generation time (with seed + content template). Returns id. */
export async function insertUniverseFull(
    name: string,
    seed: number,
    templateId: number | null,
    db: Queryable = pool,
    topology: 'random' | 'proximal' = universeConfig.topology,
): Promise<number> {
    const res = await db.query<{ id: number }>(
        'INSERT INTO universes (name, seed, template_id, topology) VALUES ($1, $2, $3, $4) RETURNING id',
        [name, seed, templateId, topology],
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

/** Look up a universe template by name; returns id (or null if not found). */
export async function getTemplateIdByName(
    name: string,
    db: Queryable = pool,
): Promise<number | null> {
    const res = await db.query<{ id: number }>('SELECT id FROM universe_template WHERE name = $1', [
        name,
    ]);
    return res.rows[0]?.id ?? null;
}

/**
 * Snapshot the given template's column values into universe_settings for the
 * specified universe. Run exactly once at universe creation; the resulting
 * row is the universe's frozen settings and is never mutated by subsequent
 * template edits.
 */
export async function snapshotTemplateForUniverse(
    universeId: number,
    templateName: string,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `INSERT INTO universe_settings (
            universe_id, max_planets_per_sector, planet_collision_likelihood,
            planet_collision_min_hours, planet_collision_max_hours,
            turns_per_day, starting_turns, max_turns, starter_ship_slug,
            starting_drones, starting_credits, starting_port_density,
            max_port_density, port_production_rate, port_memory_hours,
            max_players, max_age_days, max_planets, turn_delay,
            is_speed_warp_delay_on, photons_allowed, photon_blast_time_seconds,
            planet_spawn_density, max_ships_allowed, max_clan_size,
            max_ships_in_protected_space, truce_time_hours, is_automation_enabled,
            starting_shields, starting_earth_colonists,
            proximity_mine_damage, proximity_detonation_pct,
            seeker_attach_pct, seeker_pickup_detect_pct,
            mine_disruptor_min, mine_disruptor_max,
            respawn_delay_seconds, colos_to_produce_one_unit_per_hour,
            daily_reproduction_per_1000_colos,
            sector_count, warp_dist, two_way_pct, port_spawn_density,
            wormholes_always_two_way
         )
         SELECT $1, max_planets_per_sector, planet_collision_likelihood,
                planet_collision_min_hours, planet_collision_max_hours,
                turns_per_day, starting_turns, max_turns, starter_ship_slug,
                starting_drones, starting_credits, starting_port_density,
                max_port_density, port_production_rate, port_memory_hours,
                max_players, max_age_days, max_planets, turn_delay,
                is_speed_warp_delay_on, photons_allowed, photon_blast_time_seconds,
                planet_spawn_density, max_ships_allowed, max_clan_size,
                max_ships_in_protected_space, truce_time_hours, is_automation_enabled,
                starting_shields, starting_earth_colonists,
                proximity_mine_damage, proximity_detonation_pct,
                seeker_attach_pct, seeker_pickup_detect_pct,
                mine_disruptor_min, mine_disruptor_max,
                respawn_delay_seconds, colos_to_produce_one_unit_per_hour,
                daily_reproduction_per_1000_colos,
                sector_count, warp_dist, two_way_pct, port_spawn_density,
                wormholes_always_two_way
         FROM universe_template WHERE name = $2
         ON CONFLICT (universe_id) DO NOTHING`,
        [universeId, templateName],
    );

    // Freeze hardware prices.
    await db.query(
        `INSERT INTO universe_hardware_price (universe_id, hardware_item_id, price)
         SELECT $1, hp.hardware_item_id, hp.price
         FROM hardware_price hp
         JOIN universe_template ut ON ut.id = hp.template_id
         WHERE ut.name = $2
         ON CONFLICT (universe_id, hardware_item_id) DO NOTHING`,
        [universeId, templateName],
    );

    // Freeze ship types.
    await db.query(
        `INSERT INTO universe_ship_types (
            universe_id, slug, display_name, make, sort_order,
            max_drones, max_shields, starting_holds, max_holds,
            odds_offensive, odds_defensive,
            has_pod, can_land, has_interdictor,
            has_planetary_defense_bonus, planetary_defense_odds,
            speed, turns_per_warp,
            cost_drive, cost_computer, cost_hull, hold_cost,
            max_drone_attack, transporter_range,
            has_tractor, piloting_restriction, notes
         )
         SELECT $1, tst.slug, tst.display_name, tst.make, tst.sort_order,
                tst.max_drones, tst.max_shields, tst.starting_holds, tst.max_holds,
                tst.odds_offensive, tst.odds_defensive,
                tst.has_pod, tst.can_land, tst.has_interdictor,
                tst.has_planetary_defense_bonus, tst.planetary_defense_odds,
                tst.speed, tst.turns_per_warp,
                tst.cost_drive, tst.cost_computer, tst.cost_hull, tst.hold_cost,
                tst.max_drone_attack, tst.transporter_range,
                tst.has_tractor, tst.piloting_restriction, tst.notes
         FROM template_ship_types tst
         JOIN universe_template ut ON ut.id = tst.template_id
         WHERE ut.name = $2
         ON CONFLICT (universe_id, slug) DO NOTHING`,
        [universeId, templateName],
    );

    // Freeze per-ship hardware caps.
    await db.query(
        `INSERT INTO universe_ship_type_hardware (universe_id, ship_type_slug, hardware_item_id, max_quantity)
         SELECT $1, tsh.ship_type_slug, tsh.hardware_item_id, tsh.max_quantity
         FROM template_ship_type_hardware tsh
         JOIN universe_template ut ON ut.id = tsh.template_id
         WHERE ut.name = $2
         ON CONFLICT (universe_id, ship_type_slug, hardware_item_id) DO NOTHING`,
        [universeId, templateName],
    );

    // Freeze planet types.
    await db.query(
        `INSERT INTO universe_planet_types (
            universe_id, slug, display_name, description,
            max_fuel_colos, max_org_colos, max_equ_colos, max_drone_colos,
            max_fuel, max_org, max_equ, max_drones,
            max_citadel, fuel_production, organics_production, equipment_production,
            drone_production, danger
         )
         SELECT $1, tpt.slug, tpt.display_name, tpt.description,
                tpt.max_fuel_colos, tpt.max_org_colos, tpt.max_equ_colos, tpt.max_drone_colos,
                tpt.max_fuel, tpt.max_org, tpt.max_equ, tpt.max_drones,
                tpt.max_citadel, tpt.fuel_production, tpt.organics_production, tpt.equipment_production,
                tpt.drone_production, tpt.danger
         FROM template_planet_types tpt
         JOIN universe_template ut ON ut.id = tpt.template_id
         WHERE ut.name = $2
         ON CONFLICT (universe_id, slug) DO NOTHING`,
        [universeId, templateName],
    );
}

/** Earth starting colonists for a universe (falls back to 1,000,000 if no row). */
export async function getEarthStartingColonistsForUniverse(
    universeId: number,
    db: Queryable = pool,
): Promise<number> {
    const res = await db.query<{ col: number }>(
        `SELECT starting_earth_colonists AS col
         FROM universe_settings WHERE universe_id = $1`,
        [universeId],
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
    starter_ship_slug: string | null;
    respawn_delay_seconds: number | null;
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
                us.max_planets_per_sector,
                us.starting_turns, us.starting_credits, us.starting_drones, us.starter_ship_slug,
                us.respawn_delay_seconds
         FROM universes u
         LEFT JOIN universe_settings us ON us.universe_id = u.id
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

/** New-player defaults for a universe (falls back to NULL if no settings row). */
export type UniverseTemplateDefaults = {
    id: number;
    starting_turns: number | null;
    starting_credits: number | null;
    starter_ship_slug: string | null;
    starting_drones: number | null;
};
export async function getUniverseTemplateDefaults(
    universeId: number,
    db: Queryable = pool,
): Promise<UniverseTemplateDefaults | undefined> {
    const res = await db.query<UniverseTemplateDefaults>(
        `SELECT u.id, us.starting_turns, us.starting_credits, us.starter_ship_slug, us.starting_drones
         FROM universes u
         LEFT JOIN universe_settings us ON us.universe_id = u.id
         WHERE u.id = $1`,
        [universeId],
    );
    return res.rows[0];
}

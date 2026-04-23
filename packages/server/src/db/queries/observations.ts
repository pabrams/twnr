import { pool } from '../index.js';
import type { Queryable } from '../types.js';

export type RecordedPort = { class: number } | null;
export type RecordedPlanet = { name: string; type: string | null };

/**
 * Upsert the player-visited-sector row and re-write the snapshot of the
 * sector's port and planets. Called whenever the server sends the sector's
 * contents to the player. Port/planet observation rows are snapshots that
 * persist through later destruction of the live records until re-visit.
 *
 * Uses ON CONFLICT / set-difference queries instead of delete-then-insert so
 * concurrent calls for the same (player, sector) don't collide.
 */
export async function recordSectorObservation(
    playerId: number,
    sectorId: number,
    port: RecordedPort,
    planets: RecordedPlanet[],
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `INSERT INTO player_visited_sectors (player_id, sector_id)
         VALUES ($1, $2)
         ON CONFLICT (player_id, sector_id)
         DO UPDATE SET last_seen_at = NOW()`,
        [playerId, sectorId],
    );

    if (port) {
        await db.query(
            `INSERT INTO player_port_observations (player_id, sector_id, port_class, observed_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (player_id, sector_id)
             DO UPDATE SET port_class = EXCLUDED.port_class, observed_at = NOW()`,
            [playerId, sectorId, port.class],
        );
    } else {
        await db.query(
            'DELETE FROM player_port_observations WHERE player_id = $1 AND sector_id = $2',
            [playerId, sectorId],
        );
    }

    // Planets: upsert the current set, then delete any observations for this
    // (player, sector) that weren't in the current set.
    const planetNames = planets.map((p) => p.name);
    for (const pl of planets) {
        await db.query(
            `INSERT INTO player_planet_observations
               (player_id, sector_id, planet_name, planet_type, observed_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (player_id, sector_id, planet_name)
             DO UPDATE SET planet_type = EXCLUDED.planet_type, observed_at = NOW()`,
            [playerId, sectorId, pl.name, pl.type],
        );
    }
    if (planetNames.length === 0) {
        await db.query(
            'DELETE FROM player_planet_observations WHERE player_id = $1 AND sector_id = $2',
            [playerId, sectorId],
        );
    } else {
        await db.query(
            `DELETE FROM player_planet_observations
             WHERE player_id = $1 AND sector_id = $2
               AND NOT (planet_name = ANY($3::text[]))`,
            [playerId, sectorId, planetNames],
        );
    }
}

export type NeighborhoodSectorRow = {
    id: number;
    sector_number: number;
    x: number | null;
    y: number | null;
    port_class: number | null;
    port_observed_at: Date | null;
};

/**
 * Return every sector the player has visited in the universe, with its observed
 * port (if any). Used as the seed set for neighborhood visibility.
 */
export async function listVisitedSectorsForUniverse(
    playerId: number,
    universeId: number,
    db: Queryable = pool,
): Promise<NeighborhoodSectorRow[]> {
    const res = await db.query<NeighborhoodSectorRow>(
        `SELECT s.id, s.sector_number, s.x, s.y,
                po.port_class, po.observed_at AS port_observed_at
         FROM player_visited_sectors pvs
         JOIN sectors s ON pvs.sector_id = s.id
         LEFT JOIN player_port_observations po
           ON po.player_id = pvs.player_id AND po.sector_id = pvs.sector_id
         WHERE pvs.player_id = $1 AND s.universe_id = $2`,
        [playerId, universeId],
    );
    return res.rows;
}

export type PlanetObservationRow = {
    sector_id: number;
    planet_name: string;
    planet_type: string | null;
    observed_at: Date;
};

export async function listPlanetObservationsForSectors(
    playerId: number,
    sectorIds: number[],
    db: Queryable = pool,
): Promise<PlanetObservationRow[]> {
    if (sectorIds.length === 0) return [];
    const res = await db.query<PlanetObservationRow>(
        `SELECT sector_id, planet_name, planet_type, observed_at
         FROM player_planet_observations
         WHERE player_id = $1 AND sector_id = ANY($2::int[])`,
        [playerId, sectorIds],
    );
    return res.rows;
}

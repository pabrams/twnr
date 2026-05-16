import { pool } from '../index.js';
import type { Queryable } from '../types.js';

export type TowableMannedRow = {
    player_id: number;
    player_name: string;
    clan_number: number | null;
    ship_id: number;
    ship_name: string;
    ship_type_name: string;
    ship_type_display_name: string | null;
    ship_drones: number;
    ship_turns_per_warp: number;
};

export type TowableUnmannedRow = {
    ship_id: number;
    ship_name: string;
    ship_type_name: string;
    ship_type_display_name: string | null;
    ship_drones: number;
    ship_turns_per_warp: number;
    owner_player_id: number | null;
    owner_player_name: string | null;
    owner_player_clan_number: number | null;
    owner_clan_id: number | null;
    owner_clan_name: string | null;
    owner_clan_number: number | null;
};

/** Other players (and their ships) in the same sector as `playerId`. Used as
 *  the manned-tow candidate list — excludes `playerId` themselves. Includes
 *  players who are docked or on a planet; the caller can filter visibility. */
export async function getMannedTowables(
    playerId: number,
    sectorDbId: number,
    db: Queryable = pool,
): Promise<TowableMannedRow[]> {
    const res = await db.query<TowableMannedRow>(
        `SELECT p.id AS player_id, p.name AS player_name,
                c.universe_clan_number AS clan_number,
                sh.id AS ship_id, sh.name AS ship_name,
                st.slug AS ship_type_name, st.display_name AS ship_type_display_name,
                sh.drones AS ship_drones, sh.turns_per_warp AS ship_turns_per_warp
         FROM players p
         JOIN ships sh ON p.ship_id = sh.id
         JOIN ship_types st ON sh.ship_type_id = st.id
         LEFT JOIN clans c ON p.clan_id = c.id
         WHERE p.current_sector_id = $2
           AND p.id != $1
           AND p.on_planet_id IS NULL
           AND p.docked = FALSE`,
        [playerId, sectorDbId],
    );
    return res.rows;
}

/** Unmanned ships (no player currently piloting) in the sector owned by the
 *  given player or their clan. */
export async function getUnmannedTowables(
    playerId: number,
    clanId: number | null,
    sectorDbId: number,
    db: Queryable = pool,
): Promise<TowableUnmannedRow[]> {
    const res = await db.query<TowableUnmannedRow>(
        `SELECT sh.id AS ship_id, sh.name AS ship_name,
                st.slug AS ship_type_name, st.display_name AS ship_type_display_name,
                sh.drones AS ship_drones, sh.turns_per_warp AS ship_turns_per_warp,
                sh.owner_player_id,
                op.name AS owner_player_name,
                opc.universe_clan_number AS owner_player_clan_number,
                sh.owner_clan_id,
                oc.name AS owner_clan_name,
                oc.universe_clan_number AS owner_clan_number
         FROM ships sh
         JOIN ship_types st ON sh.ship_type_id = st.id
         LEFT JOIN players op ON sh.owner_player_id = op.id
         LEFT JOIN clans opc ON op.clan_id = opc.id
         LEFT JOIN clans oc ON sh.owner_clan_id = oc.id
         WHERE sh.sector_id = $2
           AND NOT EXISTS (SELECT 1 FROM players p2 WHERE p2.ship_id = sh.id)
           AND (sh.owner_player_id = $1 OR ($3::int IS NOT NULL AND sh.owner_clan_id = $3))`,
        [playerId, sectorDbId, clanId],
    );
    return res.rows;
}

export async function setTowedShip(
    playerId: number,
    shipId: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query('UPDATE players SET towed_ship_id = $1 WHERE id = $2', [shipId, playerId]);
}

export type LockedTowTargetRow = {
    ship_id: number;
    ship_name: string;
    ship_type_name: string;
    ship_type_display_name: string | null;
    ship_drones: number;
    ship_turns_per_warp: number;
    ship_sector_id: number;
    owner_player_id: number | null;
    owner_clan_id: number | null;
    pilot_player_id: number | null;
    pilot_player_name: string | null;
};

/**
 * Lock the candidate ship row and return its current state. The lock blocks
 * concurrent moves of this ship (which UPDATE the same row), so callers can
 * safely re-verify sector + drone + ownership invariants before committing
 * the tow.
 */
export async function lockTowTarget(
    shipId: number,
    db: Queryable,
): Promise<LockedTowTargetRow | undefined> {
    const res = await db.query<LockedTowTargetRow>(
        `SELECT sh.id AS ship_id, sh.name AS ship_name,
                st.slug AS ship_type_name, st.display_name AS ship_type_display_name,
                sh.drones AS ship_drones,
                sh.turns_per_warp AS ship_turns_per_warp,
                sh.sector_id AS ship_sector_id,
                sh.owner_player_id, sh.owner_clan_id,
                pp.id AS pilot_player_id, pp.name AS pilot_player_name
         FROM ships sh
         JOIN ship_types st ON sh.ship_type_id = st.id
         LEFT JOIN players pp ON pp.ship_id = sh.id
         WHERE sh.id = $1
         FOR UPDATE OF sh`,
        [shipId],
    );
    return res.rows[0];
}

export async function clearTowedShip(playerId: number, db: Queryable = pool): Promise<void> {
    await db.query('UPDATE players SET towed_ship_id = NULL WHERE id = $1', [playerId]);
}

export type TowStateRow = {
    towed_ship_id: number;
    towed_ship_name: string;
    towed_ship_type_display_name: string | null;
    towed_ship_turns_per_warp: number;
    towed_owner_player_id: number | null;
    towed_owner_player_name: string | null;
};

/** Tow context for the towing player. Null if not towing. */
export async function getTowState(
    playerId: number,
    db: Queryable = pool,
): Promise<TowStateRow | null> {
    const res = await db.query<TowStateRow>(
        `SELECT sh.id AS towed_ship_id, sh.name AS towed_ship_name,
                st.display_name AS towed_ship_type_display_name,
                sh.turns_per_warp AS towed_ship_turns_per_warp,
                op.id AS towed_owner_player_id, op.name AS towed_owner_player_name
         FROM players p
         JOIN ships sh ON p.towed_ship_id = sh.id
         JOIN ship_types st ON sh.ship_type_id = st.id
         LEFT JOIN players op ON op.ship_id = sh.id
         WHERE p.id = $1`,
        [playerId],
    );
    return res.rows[0] ?? null;
}

/** Returns the towing player's id if `shipId` is currently being towed, else null. */
export async function getTowingPlayerForShip(
    shipId: number,
    db: Queryable = pool,
): Promise<number | null> {
    const res = await db.query<{ id: number }>('SELECT id FROM players WHERE towed_ship_id = $1', [
        shipId,
    ]);
    return res.rows[0]?.id ?? null;
}

/** Move the towed ship along with its tower: set sector_id; if a player
 *  currently pilots that ship, update their current_sector_id too. */
export async function moveTowedShip(
    towedShipId: number,
    destSectorDbId: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query('UPDATE ships SET sector_id = $1 WHERE id = $2', [destSectorDbId, towedShipId]);
    await db.query('UPDATE players SET current_sector_id = $1 WHERE ship_id = $2', [
        destSectorDbId,
        towedShipId,
    ]);
}

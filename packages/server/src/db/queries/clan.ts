import { pool } from '../index.js';
import type { Queryable } from '../types.js';

export type ClanRow = {
    id: number;
    universe_clan_number: number;
    name: string;
    leader_id: number;
    universe_id: number;
};

export async function getClanById(
    clanId: number,
    db: Queryable = pool,
): Promise<ClanRow | undefined> {
    const res = await db.query<ClanRow>(
        `SELECT id, universe_clan_number, name, leader_id, universe_id
         FROM clans WHERE id = $1`,
        [clanId],
    );
    return res.rows[0];
}

export async function getClanByNameInUniverse(
    name: string,
    universeId: number,
    db: Queryable = pool,
): Promise<(ClanRow & { password_hash: string }) | undefined> {
    const res = await db.query<ClanRow & { password_hash: string }>(
        `SELECT id, universe_clan_number, name, leader_id, universe_id, password_hash
         FROM clans WHERE name = $1 AND universe_id = $2`,
        [name, universeId],
    );
    return res.rows[0];
}

/** Insert a new clan row, computing the next per-universe clan number
 *  inside the INSERT via MAX+1 (same pattern as ships.universe_ship_number). */
export async function insertClan(
    universeId: number,
    name: string,
    passwordHash: string,
    leaderPlayerId: number,
    db: Queryable = pool,
): Promise<{ id: number; universeClanNumber: number }> {
    const res = await db.query<{ id: number; universe_clan_number: number }>(
        `INSERT INTO clans (universe_id, universe_clan_number, name, password_hash, leader_id)
         SELECT $1,
                COALESCE((SELECT MAX(universe_clan_number) FROM clans WHERE universe_id = $1), 0) + 1,
                $2, $3, $4
         RETURNING id, universe_clan_number`,
        [universeId, name, passwordHash, leaderPlayerId],
    );
    const row = res.rows[0];
    return { id: row.id, universeClanNumber: row.universe_clan_number };
}

export async function setPlayerClanId(
    playerId: number,
    clanId: number | null,
    db: Queryable = pool,
): Promise<void> {
    await db.query('UPDATE players SET clan_id = $1 WHERE id = $2', [clanId, playerId]);
}

export async function setClanLeader(
    clanId: number,
    newLeaderId: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query('UPDATE clans SET leader_id = $1 WHERE id = $2', [newLeaderId, clanId]);
}

export async function setClanPasswordHash(
    clanId: number,
    passwordHash: string,
    db: Queryable = pool,
): Promise<void> {
    await db.query('UPDATE clans SET password_hash = $1 WHERE id = $2', [passwordHash, clanId]);
}

export async function deleteClan(clanId: number, db: Queryable = pool): Promise<void> {
    await db.query('DELETE FROM clans WHERE id = $1', [clanId]);
}

export type ClanListEntryRow = {
    id: number;
    universe_clan_number: number;
    name: string;
    member_count: number;
    leader_name: string | null;
};

export async function listClansInUniverse(
    universeId: number,
    db: Queryable = pool,
): Promise<ClanListEntryRow[]> {
    const res = await db.query<ClanListEntryRow>(
        `SELECT c.id, c.universe_clan_number, c.name,
                (SELECT COUNT(*) FROM players p WHERE p.clan_id = c.id)::int AS member_count,
                (SELECT name FROM players p WHERE p.id = c.leader_id) AS leader_name
         FROM clans c
         WHERE c.universe_id = $1
         ORDER BY c.universe_clan_number`,
        [universeId],
    );
    return res.rows;
}

/** Resolve a player's clan_id (null when not in a clan). Shared by every
 *  call site that needs to gate on clan membership or check clan-friendly
 *  ownership of an asset. */
export async function getPlayerClanId(
    playerId: number,
    db: Queryable = pool,
): Promise<number | null> {
    const res = await db.query<{ clan_id: number | null }>(
        'SELECT clan_id FROM players WHERE id = $1',
        [playerId],
    );
    return res.rows[0]?.clan_id ?? null;
}

export type ClanMemberRow = {
    id: number;
    name: string;
};

/** Members of a clan, leader first then by id. */
export async function getClanMembers(
    clanId: number,
    db: Queryable = pool,
): Promise<ClanMemberRow[]> {
    const res = await db.query<ClanMemberRow>(
        `SELECT p.id, p.name
         FROM players p
         WHERE p.clan_id = $1
         ORDER BY (p.id = (SELECT leader_id FROM clans WHERE id = $1)) DESC, p.id`,
        [clanId],
    );
    return res.rows;
}

export type ClanmateLocationRow = {
    id: number;
    name: string;
    sector_number: number | null;
    fighters: number;
    shields: number;
    mines: number;
    credits: number;
};

/** Per-clanmate snapshot for the L command in the clan menu: current sector,
 *  ship fighter/shield counts, summed proximity+seeker mines on board, and
 *  credits. Players with no ship show zeroes and null sector. */
export async function getClanmateLocations(
    clanId: number,
    db: Queryable = pool,
): Promise<ClanmateLocationRow[]> {
    const res = await db.query<ClanmateLocationRow>(
        `SELECT p.id,
                p.name,
                sec.sector_number AS sector_number,
                COALESCE(s.drones, 0)::int  AS fighters,
                COALESCE(s.shields, 0)::int AS shields,
                COALESCE((
                    SELECT SUM(sh.quantity)::int
                    FROM ship_hardware sh
                    JOIN hardware_item hi ON hi.id = sh.hardware_item_id
                    WHERE sh.ship_id = s.id
                      AND hi.name IN ('proximity_mine', 'seeker_mine')
                ), 0) AS mines,
                p.credits
         FROM players p
         LEFT JOIN ships s ON s.id = p.ship_id
         LEFT JOIN sectors sec ON sec.id = p.current_sector_id
         WHERE p.clan_id = $1
         ORDER BY (p.id = (SELECT leader_id FROM clans WHERE id = $1)) DESC, p.name`,
        [clanId],
    );
    return res.rows;
}

/**
 * Sum of reputation across all members of a clan. Used as the "corp
 * alignment" for clan-owned sector fighters when computing combat rewards.
 * Returns 0 for an empty clan.
 */
export async function getClanTotalReputation(
    clanId: number,
    db: Queryable = pool,
): Promise<number> {
    const res = await db.query<{ sum: string | null }>(
        'SELECT COALESCE(SUM(reputation), 0)::text AS sum FROM players WHERE clan_id = $1',
        [clanId],
    );
    return Number(res.rows[0]?.sum ?? 0);
}

export async function getClanMemberCount(clanId: number, db: Queryable = pool): Promise<number> {
    const res = await db.query<{ c: number }>(
        'SELECT COUNT(*)::int AS c FROM players WHERE clan_id = $1',
        [clanId],
    );
    return res.rows[0]?.c ?? 0;
}

export async function getMaxClanSize(universeId: number, db: Queryable = pool): Promise<number> {
    const res = await db.query<{ max_clan_size: number }>(
        'SELECT max_clan_size FROM universe_settings WHERE universe_id = $1',
        [universeId],
    );
    return res.rows[0]?.max_clan_size ?? 4;
}

/** True iff the player's current ship is owned by their clan. Used to block
 *  leaving the clan while piloting a clan ship (non-last-member rule). */
export async function isPlayerOnClanShip(
    playerId: number,
    clanId: number,
    db: Queryable = pool,
): Promise<boolean> {
    const res = await db.query<{ ok: boolean }>(
        `SELECT (s.owner_clan_id = $2) AS ok
         FROM players p
         LEFT JOIN ships s ON s.id = p.ship_id
         WHERE p.id = $1`,
        [playerId, clanId],
    );
    return res.rows[0]?.ok === true;
}

/** Dissolution helper: re-owns clan assets in the leaver's current sector
 *  (except planets) to the leaving player, and clears clan ownership of
 *  everything else (assets in other sectors become rogue). Caller is
 *  responsible for the DELETE on the clan row + clearing the player's
 *  clan_id. */
export async function dissolveClanAssets(
    clanId: number,
    leavingPlayerId: number,
    currentSectorId: number,
    db: Queryable = pool,
): Promise<{ convertedToPersonal: number; convertedToRogue: number }> {
    // Ships in current sector → personal
    const r1 = await db.query<{ n: number }>(
        `WITH upd AS (
            UPDATE ships SET owner_clan_id = NULL, owner_player_id = $1
            WHERE owner_clan_id = $2 AND sector_id = $3
            RETURNING 1
         ) SELECT COUNT(*)::int AS n FROM upd`,
        [leavingPlayerId, clanId, currentSectorId],
    );
    // sector_drones in current sector → personal
    const r2 = await db.query<{ n: number }>(
        `WITH upd AS (
            UPDATE sector_drones SET owner_clan_id = NULL, owner_player_id = $1
            WHERE owner_clan_id = $2 AND sector_id = $3
            RETURNING 1
         ) SELECT COUNT(*)::int AS n FROM upd`,
        [leavingPlayerId, clanId, currentSectorId],
    );
    // sector_mines in current sector → personal
    const r3 = await db.query<{ n: number }>(
        `WITH upd AS (
            UPDATE sector_mines SET owner_clan_id = NULL, owner_player_id = $1
            WHERE owner_clan_id = $2 AND sector_id = $3
            RETURNING 1
         ) SELECT COUNT(*)::int AS n FROM upd`,
        [leavingPlayerId, clanId, currentSectorId],
    );
    // sector_beacons in current sector → personal
    const r4 = await db.query<{ n: number }>(
        `WITH upd AS (
            UPDATE sector_beacons SET owner_clan_id = NULL, owner_player_id = $1
            WHERE owner_clan_id = $2 AND sector_id = $3
            RETURNING 1
         ) SELECT COUNT(*)::int AS n FROM upd`,
        [leavingPlayerId, clanId, currentSectorId],
    );

    // Everything else owned by this clan → rogue (clear owner_clan_id).
    // Planets (any sector) are intentionally included here — planets do NOT
    // convert to personal even in the current sector; they go rogue and can
    // be claimed via the planet menu later.
    const r5 = await db.query<{ n: number }>(
        `WITH r AS (
            UPDATE ships SET owner_clan_id = NULL WHERE owner_clan_id = $1 RETURNING 1
         ), r2 AS (
            UPDATE sector_drones SET owner_clan_id = NULL WHERE owner_clan_id = $1 RETURNING 1
         ), r3 AS (
            UPDATE sector_mines SET owner_clan_id = NULL WHERE owner_clan_id = $1 RETURNING 1
         ), r4 AS (
            UPDATE sector_beacons SET owner_clan_id = NULL WHERE owner_clan_id = $1 RETURNING 1
         ), r5 AS (
            UPDATE planets SET owner_clan_id = NULL WHERE owner_clan_id = $1 RETURNING 1
         ) SELECT (SELECT COUNT(*) FROM r) + (SELECT COUNT(*) FROM r2)
                + (SELECT COUNT(*) FROM r3) + (SELECT COUNT(*) FROM r4)
                + (SELECT COUNT(*) FROM r5) AS n`,
        [clanId],
    );

    const convertedToPersonal =
        (r1.rows[0]?.n ?? 0) + (r2.rows[0]?.n ?? 0) + (r3.rows[0]?.n ?? 0) + (r4.rows[0]?.n ?? 0);
    const convertedToRogue = r5.rows[0]?.n ?? 0;
    return { convertedToPersonal, convertedToRogue };
}

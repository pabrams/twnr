import { pool } from '../index.js';
import type { Queryable } from '../types.js';

export async function adjustReputationAndExperience(
    playerId: number,
    reputationDelta: number,
    experienceDelta: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        'UPDATE players SET reputation = reputation + $2, experience = experience + $3 WHERE id = $1',
        [playerId, reputationDelta, experienceDelta],
    );
}

export async function getPlayerReputationForUpdate(
    playerId: number,
    db: Queryable = pool,
): Promise<number> {
    const res = await db.query<{ reputation: number }>(
        'SELECT reputation FROM players WHERE id = $1 FOR UPDATE',
        [playerId],
    );
    return res.rows[0]?.reputation ?? 0;
}

/**
 * Snapshot reputation+experience under a FOR UPDATE lock. Used by combat
 * reward calculations so the attacker-bonus math sees a consistent
 * defender state even if other transactions are mid-flight.
 */
export async function getPlayerRepExpForUpdate(
    playerId: number,
    db: Queryable = pool,
): Promise<{ reputation: number; experience: number }> {
    const res = await db.query<{ reputation: number; experience: number }>(
        'SELECT reputation, experience FROM players WHERE id = $1 FOR UPDATE',
        [playerId],
    );
    return res.rows[0] ?? { reputation: 0, experience: 0 };
}

/**
 * Atomically mark "first colos jettison today" for a player. Returns true
 * only on the FIRST call within a calendar day (UTC); subsequent calls the
 * same day return false. Update + check happens in one statement so two
 * concurrent jettisons can't both win the "first today" prize.
 */
export async function markFirstColosJettisonOfDay(
    playerId: number,
    db: Queryable = pool,
): Promise<boolean> {
    const res = await db.query(
        `UPDATE players SET last_colos_jettison_at = NOW()
         WHERE id = $1
           AND (last_colos_jettison_at IS NULL
                OR last_colos_jettison_at::date < (NOW() AT TIME ZONE 'UTC')::date)`,
        [playerId],
    );
    return (res.rowCount ?? 0) > 0;
}

/** Resolve a player's current ship_id. Returns null if the player has
 *  no ship (destroyed, awaiting a starter, etc.). */
export async function getPlayerShipId(
    playerId: number,
    db: Queryable = pool,
): Promise<number | null> {
    const res = await db.query<{ ship_id: number | null }>(
        'SELECT ship_id FROM players WHERE id = $1',
        [playerId],
    );
    return res.rows[0]?.ship_id ?? null;
}

export async function getOnPlanetId(
    playerId: number,
    db: Queryable = pool,
): Promise<number | null> {
    const res = await db.query<{ on_planet_id: number | null }>(
        'SELECT on_planet_id FROM players WHERE id = $1',
        [playerId],
    );
    return res.rows[0]?.on_planet_id ?? null;
}

export async function getCurrentSector(
    playerId: number,
    db: Queryable = pool,
): Promise<number | undefined> {
    const res = await db.query<{ sector_number: number }>(
        'SELECT s.sector_number FROM players p JOIN sectors s ON p.current_sector_id = s.id WHERE p.id = $1',
        [playerId],
    );
    return res.rows[0]?.sector_number;
}

export type SectorPlayerRow = {
    id: number;
    name: string;
    docked: boolean;
    on_planet_id: number | null;
    clan_number: number | null;
    ship_name: string | null;
    ship_type_name: string | null;
    ship_display_name: string | null;
    ship_drones: number;
};

/** Every player whose current sector matches, regardless of online status.
 *  Caller applies the visibility predicate (planet/cloak/online-and-docked). */
export async function listPlayersInSector(
    sectorNumber: number,
    universeId: number,
    excludePlayerId: number,
    db: Queryable = pool,
): Promise<SectorPlayerRow[]> {
    const res = await db.query<SectorPlayerRow>(
        `SELECT p.id, p.name, p.docked, p.on_planet_id,
                c.universe_clan_number AS clan_number,
                sh.name AS ship_name,
                st.slug AS ship_type_name,
                st.display_name AS ship_display_name,
                COALESCE(sh.drones, 0) AS ship_drones
         FROM players p
         JOIN sectors s ON p.current_sector_id = s.id
         LEFT JOIN clans c ON p.clan_id = c.id
         LEFT JOIN ships sh ON p.ship_id = sh.id
         LEFT JOIN universe_ship_types st ON st.universe_id = sh.universe_id AND st.slug = sh.ship_type_slug
         WHERE s.sector_number = $1 AND p.universe_id = $2 AND p.id != $3`,
        [sectorNumber, universeId, excludePlayerId],
    );
    return res.rows;
}

export type AttackTargetRow = {
    universe_id: number;
    sector_number: number;
    docked: boolean;
    on_planet_id: number | null;
};

/** Sector + visibility fields for a single player by id, online or not. */
export async function getAttackTargetInfo(
    playerId: number,
    db: Queryable = pool,
): Promise<AttackTargetRow | undefined> {
    const res = await db.query<AttackTargetRow>(
        `SELECT p.universe_id, s.sector_number, p.docked, p.on_planet_id
         FROM players p
         JOIN sectors s ON p.current_sector_id = s.id
         WHERE p.id = $1`,
        [playerId],
    );
    return res.rows[0];
}

export async function getCreditsForUpdate(
    playerId: number,
    db: Queryable = pool,
): Promise<number | undefined> {
    const res = await db.query<{ credits: number }>(
        'SELECT credits FROM players WHERE id = $1 FOR UPDATE',
        [playerId],
    );
    return res.rows[0]?.credits;
}

export async function setDocked(playerId: number, docked: boolean): Promise<void> {
    await pool.query('UPDATE players SET docked = $1 WHERE id = $2', [docked, playerId]);
}

export async function setOnPlanet(
    playerId: number,
    planetId: number | null,
    db: Queryable = pool,
): Promise<void> {
    await db.query('UPDATE players SET on_planet_id = $1 WHERE id = $2', [planetId, playerId]);
}

export async function deductCredits(
    playerId: number,
    amount: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query('UPDATE players SET credits = credits - $1 WHERE id = $2', [amount, playerId]);
}

export async function addCredits(
    playerId: number,
    amount: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query('UPDATE players SET credits = credits + $1 WHERE id = $2', [amount, playerId]);
}

export async function moveToSector(
    playerId: number,
    sectorId: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        'UPDATE players SET previous_sector_id = current_sector_id, current_sector_id = $1 WHERE id = $2',
        [sectorId, playerId],
    );
}

export async function getPreviousSectorNumber(
    playerId: number,
    db: Queryable = pool,
): Promise<number | null> {
    const res = await db.query<{ sector_number: number }>(
        `SELECT s.sector_number FROM players p
         JOIN sectors s ON p.previous_sector_id = s.id
         WHERE p.id = $1`,
        [playerId],
    );
    return res.rows[0]?.sector_number ?? null;
}

export async function markSectorVisited(
    playerId: number,
    sectorId: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        'INSERT INTO player_visited_sectors (player_id, sector_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [playerId, sectorId],
    );
}

/** Player record for WebSocket connect: includes joined sector + ship info. */
export type PlayerConnectRow = {
    id: number;
    name: string;
    current_sector_id: number;
    ship_id: number | null;
    sector_number: number;
    ship_name: string | null;
    ship_display_name: string | null;
    clan_id: number | null;
};

/** Look up a user's player record in a specific universe, with joined sector + ship. */
export async function getPlayerConnectInfo(
    userId: number,
    universeId: number,
    db: Queryable = pool,
): Promise<PlayerConnectRow | undefined> {
    const res = await db.query<PlayerConnectRow>(
        `SELECT p.id, p.name, p.current_sector_id, p.ship_id, s.sector_number,
                st.slug AS ship_name, st.display_name AS ship_display_name,
                p.clan_id
         FROM players p
         JOIN sectors s ON p.current_sector_id = s.id
         LEFT JOIN ships sh ON p.ship_id = sh.id
         LEFT JOIN universe_ship_types st ON st.universe_id = sh.universe_id AND st.slug = sh.ship_type_slug
         WHERE p.user_id = $1 AND p.universe_id = $2`,
        [userId, universeId],
    );
    return res.rows[0];
}

/** Mark a player as logged-in: clear `docked` and stamp `last_login_at`. */
export async function markPlayerLoggedIn(playerId: number, db: Queryable = pool): Promise<void> {
    await db.query('UPDATE players SET docked = FALSE, last_login_at = NOW() WHERE id = $1', [
        playerId,
    ]);
}

/** Create a player row on universe join. Returns the new player id. */
export async function insertPlayer(
    name: string,
    userId: number,
    universeId: number,
    currentSectorId: number,
    startingCredits: number,
    startingTurns: number,
    db: Queryable = pool,
): Promise<number> {
    const res = await db.query<{ id: number }>(
        `INSERT INTO players (name, user_id, universe_id, current_sector_id, credits, turns, last_turns_granted_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING id`,
        [name, userId, universeId, currentSectorId, startingCredits, startingTurns],
    );
    return res.rows[0].id;
}

/** Point a player at a ship they just received. */
export async function setPlayerShipId(
    playerId: number,
    shipId: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query('UPDATE players SET ship_id = $1 WHERE id = $2', [shipId, playerId]);
}

/** Roster of players in a universe with their current ship type name + clan info. */
export type UniversePlayerRosterRow = {
    name: string;
    ship_name: string | null;
    ship_display_name: string | null;
    clan_number: number | null;
    clan_name: string | null;
    reputation: number;
    experience: number;
};
export async function listPlayersInUniverse(
    universeId: number,
    db: Queryable = pool,
): Promise<UniversePlayerRosterRow[]> {
    const res = await db.query<UniversePlayerRosterRow>(
        `SELECT p.name,
                st.slug AS ship_name, st.display_name AS ship_display_name,
                c.universe_clan_number AS clan_number,
                c.name AS clan_name,
                p.reputation, p.experience
         FROM players p
         LEFT JOIN ships s ON p.ship_id = s.id
         LEFT JOIN universe_ship_types st ON st.universe_id = s.universe_id AND st.slug = s.ship_type_slug
         LEFT JOIN clans c ON c.id = p.clan_id
         WHERE p.universe_id = $1
         ORDER BY p.experience DESC, p.name`,
        [universeId],
    );
    return res.rows;
}

/** Count players in a universe. */
export async function countPlayersInUniverse(
    universeId: number,
    db: Queryable = pool,
): Promise<number> {
    const res = await db.query<{ count: number }>(
        'SELECT COUNT(*)::int FROM players WHERE universe_id = $1',
        [universeId],
    );
    return res.rows[0]?.count ?? 0;
}

/** List player ids in a universe (used by universe delete). */
export async function listPlayerIdsInUniverse(
    universeId: number,
    db: Queryable = pool,
): Promise<number[]> {
    const res = await db.query<{ id: number }>('SELECT id FROM players WHERE universe_id = $1', [
        universeId,
    ]);
    return res.rows.map((r) => r.id);
}

/** Delete all `player_visited_sectors` rows for the given player ids. */
export async function deleteVisitedSectorsForPlayers(
    playerIds: number[],
    db: Queryable = pool,
): Promise<void> {
    if (playerIds.length === 0) return;
    await db.query('DELETE FROM player_visited_sectors WHERE player_id = ANY($1::int[])', [
        playerIds,
    ]);
}

/** Null out `ship_id` for many players at once (pre-delete step). */
export async function clearShipIdsForPlayers(
    playerIds: number[],
    db: Queryable = pool,
): Promise<void> {
    if (playerIds.length === 0) return;
    await db.query('UPDATE players SET ship_id = NULL WHERE id = ANY($1::int[])', [playerIds]);
}

/** Delete all ships owned by the given player ids. */
export async function deleteShipsByOwners(
    playerIds: number[],
    db: Queryable = pool,
): Promise<void> {
    if (playerIds.length === 0) return;
    await db.query('DELETE FROM ships WHERE owner_player_id = ANY($1::int[])', [playerIds]);
}

/** Delete all players in a universe (used by universe-delete). */
export async function deletePlayersInUniverse(
    universeId: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query('DELETE FROM players WHERE universe_id = $1', [universeId]);
}

/** Delete a single player row by id. */
export async function deletePlayerById(playerId: number, db: Queryable = pool): Promise<void> {
    await db.query('DELETE FROM players WHERE id = $1', [playerId]);
}

/** Clear a player's ship_id so they can be re-assigned a new ship. */
export async function clearPlayerShip(playerId: number, db: Queryable = pool): Promise<void> {
    await db.query('UPDATE players SET ship_id = NULL WHERE id = $1', [playerId]);
}

/**
 * Finalize a respawn once the destruction cooldown has elapsed:
 * clear ship_destroyed_date, move the player to the starting sector, and
 * reset their credits. The new ship row itself is created later when the
 * player types a name (see serveSetShipName), so ship_id stays NULL here.
 */
export async function applyRespawnReset(
    playerId: number,
    startSectorId: number,
    startingCredits: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `UPDATE players SET ship_destroyed_date = NULL, current_sector_id = $2, credits = $3
         WHERE id = $1`,
        [playerId, startSectorId, startingCredits],
    );
}

export async function findPlayersByNamePrefix(
    universeId: number,
    prefix: string,
    db: Queryable = pool,
): Promise<{ id: number; name: string }[]> {
    const res = await db.query<{ id: number; name: string }>(
        `SELECT id, name FROM players
         WHERE universe_id = $1 AND LOWER(name) LIKE LOWER($2) || '%'
         ORDER BY name ASC
         LIMIT 10`,
        [universeId, prefix],
    );
    return res.rows;
}

/** Count total players across all universes (admin stats). */
export async function countAllPlayers(db: Queryable = pool): Promise<number> {
    const res = await db.query<{ count: number }>('SELECT COUNT(*)::int FROM players');
    return res.rows[0]?.count ?? 0;
}

/** Stamp a player's `last_logout_at` to NOW(). */
export async function markPlayerLoggedOut(playerId: number, db: Queryable = pool): Promise<void> {
    await db.query('UPDATE players SET last_logout_at = NOW() WHERE id = $1', [playerId]);
}

/** Append a row to the per-player command log (fire-and-forget from callers). */
export async function logPlayerCommand(
    playerId: number,
    universeId: number,
    commandType: string,
    payload: unknown,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        'INSERT INTO command_log (player_id, universe_id, command_type, payload) VALUES ($1, $2, $3, $4)',
        [playerId, universeId, commandType, JSON.stringify(payload)],
    );
}

/** All sector_numbers the given player has visited (across all sectors). */
export async function getVisitedSectorNumbers(
    playerId: number,
    db: Queryable = pool,
): Promise<number[]> {
    const res = await db.query<{ sector_number: number }>(
        `SELECT s.sector_number FROM player_visited_sectors vs
         JOIN sectors s ON vs.sector_id = s.id
         WHERE vs.player_id = $1`,
        [playerId],
    );
    return res.rows.map((r) => r.sector_number);
}

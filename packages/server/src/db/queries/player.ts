import { pool } from '../index.js';
import type { Queryable } from '../types.js';

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
    await db.query('UPDATE players SET current_sector_id = $1 WHERE id = $2', [sectorId, playerId]);
}

export async function markSectorVisited(
    playerId: number,
    sectorId: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        'INSERT INTO visited_sectors (player_id, sector_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [playerId, sectorId],
    );
}

/** Update a player's `current_menu_id` by menu name. */
export async function setPlayerCurrentMenu(
    playerId: number,
    menuName: string,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `UPDATE players SET current_menu_id = (SELECT id FROM menu WHERE name = $1) WHERE id = $2`,
        [menuName, playerId],
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
};

/** Look up a user's player record in a specific universe, with joined sector + ship. */
export async function getPlayerConnectInfo(
    userId: number,
    universeId: number,
    db: Queryable = pool,
): Promise<PlayerConnectRow | undefined> {
    const res = await db.query<PlayerConnectRow>(
        `SELECT p.id, p.name, p.current_sector_id, p.ship_id, s.sector_number,
                st.name AS ship_name
         FROM players p
         JOIN sectors s ON p.current_sector_id = s.id
         LEFT JOIN ships sh ON p.ship_id = sh.id
         LEFT JOIN ship_types st ON sh.ship_type_id = st.id
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

/** Roster of players in a universe with their current ship type name. */
export type UniversePlayerRosterRow = {
    name: string;
    ship_name: string;
};
export async function listPlayersInUniverse(
    universeId: number,
    db: Queryable = pool,
): Promise<UniversePlayerRosterRow[]> {
    const res = await db.query<UniversePlayerRosterRow>(
        `SELECT p.name, COALESCE(st.name, 'No ship') AS ship_name
         FROM players p
         LEFT JOIN ships s ON p.ship_id = s.id
         LEFT JOIN ship_types st ON s.ship_type_id = st.id
         WHERE p.universe_id = $1
         ORDER BY p.name`,
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

/** Delete all `visited_sectors` rows for the given player ids. */
export async function deleteVisitedSectorsForPlayers(
    playerIds: number[],
    db: Queryable = pool,
): Promise<void> {
    if (playerIds.length === 0) return;
    await db.query('DELETE FROM visited_sectors WHERE player_id = ANY($1::int[])', [playerIds]);
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
    await db.query('DELETE FROM ships WHERE owner_id = ANY($1::int[])', [playerIds]);
}

/** Delete all players in a universe (used by universe-delete). */
export async function deletePlayersInUniverse(
    universeId: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query('DELETE FROM players WHERE universe_id = $1', [universeId]);
}

/** Players belonging to a user — used during login to check ship_destroyed_date. */
export type UserPlayerRow = {
    id: number;
    ship_destroyed_date: Date | null;
    universe_id: number;
};
export async function listPlayersForUser(
    userId: number,
    db: Queryable = pool,
): Promise<UserPlayerRow[]> {
    const res = await db.query<UserPlayerRow>(
        'SELECT id, ship_destroyed_date, universe_id FROM players WHERE user_id = $1',
        [userId],
    );
    return res.rows;
}

/** Clear a player's ship_id so they can be re-assigned a new ship. */
export async function clearPlayerShip(playerId: number, db: Queryable = pool): Promise<void> {
    await db.query('UPDATE players SET ship_id = NULL WHERE id = $1', [playerId]);
}

/** Respawn a player with a fresh ship + starting credits, clearing destroyed date. */
export async function respawnPlayerWithShip(
    playerId: number,
    startSectorId: number,
    shipId: number,
    startingCredits: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `UPDATE players SET ship_destroyed_date = NULL, current_sector_id = $2,
                            ship_id = $3, credits = $4
         WHERE id = $1`,
        [playerId, startSectorId, shipId, startingCredits],
    );
}

/** Respawn a player (no ship available for the starting type): just move + clear destroyed date. */
export async function respawnPlayerNoShip(
    playerId: number,
    startSectorId: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `UPDATE players SET ship_destroyed_date = NULL, current_sector_id = $2 WHERE id = $1`,
        [playerId, startSectorId],
    );
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
        `SELECT s.sector_number FROM visited_sectors vs
         JOIN sectors s ON vs.sector_id = s.id
         WHERE vs.player_id = $1`,
        [playerId],
    );
    return res.rows.map((r) => r.sector_number);
}

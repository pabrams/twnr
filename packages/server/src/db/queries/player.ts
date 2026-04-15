import { pool } from '../index.js';
import type { Queryable } from '../types.js';

export async function getOnPlanetId(
    playerId: number,
    db: Queryable = pool,
): Promise<number | null> {
    const res = await db.query<{ on_planet_id: number | null }>('SELECT on_planet_id FROM players WHERE id = $1', [playerId]);
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
    const res = await db.query<{ credits: number }>('SELECT credits FROM players WHERE id = $1 FOR UPDATE', [playerId]);
    return res.rows[0]?.credits;
}

export async function getShipId(playerId: number): Promise<number | null> {
    const res = await pool.query<{ ship_id: number | null }>('SELECT ship_id FROM players WHERE id = $1', [playerId]);
    return res.rows[0]?.ship_id ?? null;
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

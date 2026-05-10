import { pool } from '../index.js';
import type { Queryable } from '../types.js';
import { universeConfig } from '../../universe-config.js';

/** Per-universe turn-economy config (with template fallbacks). */
export type UniverseTurnSettings = {
    turns_per_day: number;
    turn_delay: number;
};

export async function getUniverseTurnSettings(
    universeId: number,
    db: Queryable = pool,
): Promise<UniverseTurnSettings | undefined> {
    const res = await db.query<UniverseTurnSettings>(
        `SELECT COALESCE(us.turns_per_day, ${universeConfig.turnsPerDay}) AS turns_per_day,
                COALESCE(us.turn_delay, ${universeConfig.turnDelay}) AS turn_delay
         FROM universes u LEFT JOIN universe_settings us ON us.universe_id = u.id
         WHERE u.id = $1`,
        [universeId],
    );
    return res.rows[0];
}

export async function getPlayerTurns(
    playerId: number,
    db: Queryable = pool,
): Promise<number | undefined> {
    const res = await db.query<{ turns: number }>('SELECT turns FROM players WHERE id = $1', [
        playerId,
    ]);
    return res.rows[0]?.turns;
}

export async function decrementPlayerTurns(
    playerId: number,
    cost: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query('UPDATE players SET turns = turns - $1 WHERE id = $2', [cost, playerId]);
}

/** Move-time fetch: ship existence + per-warp cost + universe turn config. */
export type MoveTurnContextRow = {
    ship_id: number | null;
    turns: number;
    turns_per_warp: number | null;
    turns_per_day: number;
    turn_delay: number;
};

export async function getMoveTurnContext(
    playerId: number,
    universeId: number,
    db: Queryable = pool,
): Promise<MoveTurnContextRow | undefined> {
    const res = await db.query<MoveTurnContextRow>(
        `SELECT p.ship_id,
                p.turns,
                s.turns_per_warp,
                COALESCE(us.turns_per_day, ${universeConfig.turnsPerDay}) AS turns_per_day,
                COALESCE(us.turn_delay, ${universeConfig.turnDelay}) AS turn_delay
         FROM players p
         LEFT JOIN ships s ON p.ship_id = s.id
         JOIN universes u ON u.id = $2
         LEFT JOIN universe_settings us ON us.universe_id = u.id
         WHERE p.id = $1`,
        [playerId, universeId],
    );
    return res.rows[0];
}

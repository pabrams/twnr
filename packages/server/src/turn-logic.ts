import { pool } from './db/index.js';
import type { Queryable } from './db/types.js';

export interface TurnResult {
    allowed: boolean;
    turnsUsed: number;
}

export interface MoveTurnContext {
    shipId: number | null;
    turns: number;
    turnsPerWarp: number;
    turnsPerDay: number;
    turnDelay: number;
}

/**
 * One-shot fetch of everything the move handler needs to decide whether a warp
 * is allowed: ship existence, current turns, per-warp cost, and the universe's
 * turn-economy config. Single query joining players, ships, universes, edits.
 */
export async function fetchMoveTurnContext(
    playerId: number,
    universeId: number,
): Promise<MoveTurnContext | null> {
    const res = await pool.query<{
        ship_id: number | null;
        turns: number;
        turns_per_warp: number | null;
        turns_per_day: number;
        turn_delay: number;
    }>(
        `SELECT p.ship_id,
                p.turns,
                s.turns_per_warp,
                COALESCE(e.turns_per_day, 500) AS turns_per_day,
                COALESCE(e.turn_delay, 100) AS turn_delay
         FROM players p
         LEFT JOIN ships s ON p.ship_id = s.id
         JOIN universes u ON u.id = $2
         LEFT JOIN edits e ON u.edit_id = e.id
         WHERE p.id = $1`,
        [playerId, universeId],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
        shipId: row.ship_id,
        turns: row.turns,
        turnsPerWarp: row.turns_per_warp ?? 1,
        turnsPerDay: row.turns_per_day,
        turnDelay: row.turn_delay,
    };
}

/**
 * Deduct turns using already-fetched context — skips the read queries that
 * checkAndDeductTurns would otherwise run. Enforces turn_delay even in
 * unlimited-turn games.
 */
export async function deductTurns(
    playerId: number,
    cost: number,
    ctx: { turns: number; turnsPerDay: number; turnDelay: number },
): Promise<TurnResult> {
    const delayMs = cost * ctx.turnDelay;

    if (ctx.turnsPerDay === 0) {
        if (delayMs > 0) await sleep(delayMs);
        return { allowed: true, turnsUsed: 0 };
    }

    if (ctx.turns < cost) return { allowed: false, turnsUsed: 0 };
    await pool.query('UPDATE players SET turns = turns - $1 WHERE id = $2', [cost, playerId]);
    if (delayMs > 0) await sleep(delayMs);
    return { allowed: true, turnsUsed: cost };
}

/**
 * Check and deduct turns for an action. Enforces the universe's turn_delay
 * (cost * turn_delay ms) before returning, even in unlimited-turn games.
 */
export async function checkAndDeductTurns(
    playerId: number,
    universeId: number,
    cost: number,
    queryFn?: Queryable,
): Promise<TurnResult> {
    const db = queryFn ?? pool;
    const univRes = await db.query<{ turns_per_day: number; turn_delay: number }>(
        `SELECT COALESCE(e.turns_per_day, 500) as turns_per_day,
                COALESCE(e.turn_delay, 100) as turn_delay
         FROM universes u LEFT JOIN edits e ON u.edit_id = e.id WHERE u.id = $1`,
        [universeId],
    );
    const { turns_per_day, turn_delay } = univRes.rows[0];
    const delayMs = cost * turn_delay;

    if (turns_per_day === 0) {
        // Unlimited turns — still enforce delay
        if (delayMs > 0) await sleep(delayMs);
        return { allowed: true, turnsUsed: 0 };
    }

    const playerRes = await db.query<{ turns: number }>('SELECT turns FROM players WHERE id = $1', [
        playerId,
    ]);
    if (playerRes.rows[0].turns < cost) return { allowed: false, turnsUsed: 0 };
    await db.query('UPDATE players SET turns = turns - $1 WHERE id = $2', [cost, playerId]);
    if (delayMs > 0) await sleep(delayMs);
    return { allowed: true, turnsUsed: cost };
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

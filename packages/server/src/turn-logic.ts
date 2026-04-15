import { pool } from './db/index.js';
import type { Queryable } from './db/types.js';

export interface TurnResult {
    allowed: boolean;
    turnsUsed: number;
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

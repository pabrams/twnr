import type { Queryable } from './db/types.js';
import {
    getUniverseTurnSettings,
    getPlayerTurns,
    decrementPlayerTurns,
    getMoveTurnContext,
} from './db/queries/turn.js';

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
 * turn-economy config.
 */
export async function fetchMoveTurnContext(
    playerId: number,
    universeId: number,
): Promise<MoveTurnContext | null> {
    const row = await getMoveTurnContext(playerId, universeId);
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
    await decrementPlayerTurns(playerId, cost);
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
    db?: Queryable,
): Promise<TurnResult> {
    const settings = await getUniverseTurnSettings(universeId, db);
    if (!settings) return { allowed: false, turnsUsed: 0 };
    const delayMs = cost * settings.turn_delay;

    if (settings.turns_per_day === 0) {
        if (delayMs > 0) await sleep(delayMs);
        return { allowed: true, turnsUsed: 0 };
    }

    const turns = await getPlayerTurns(playerId, db);
    if (turns === undefined || turns < cost) return { allowed: false, turnsUsed: 0 };
    await decrementPlayerTurns(playerId, cost, db);
    if (delayMs > 0) await sleep(delayMs);
    return { allowed: true, turnsUsed: cost };
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

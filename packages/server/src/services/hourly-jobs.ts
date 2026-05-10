import { withTransaction } from '../db/index.js';
import {
    listTurnEnabledUniverses,
    lockPlayersForTurnGrant,
    setPlayerTurnsAndStamp,
} from '../db/queries/turn.js';
import {
    listPlanetIdsWithColonists,
    settlePlanetProduction,
} from '../db/queries/planet.js';

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Hourly turn grant: every player in a universe with turns_per_day > 0
 * gets `floor(elapsed_hours * turns_per_day / 24)` turns added since
 * their last grant, capped at the universe's max_turns. Skips players
 * who haven't had a full hour elapse — the standalone
 * `scripts/grant-turns.js` follows the same rule, and tests assert
 * idempotency.
 *
 * Returns the number of player rows updated.
 */
export async function runGrantTurns(): Promise<number> {
    const result = await withTransaction(async (client) => {
        const universes = await listTurnEnabledUniverses(client);
        let updated = 0;
        for (const u of universes) {
            const hourlyRate = Math.floor(u.turns_per_day / 24);
            if (hourlyRate <= 0) continue;
            const players = await lockPlayersForTurnGrant(u.id, client);
            for (const p of players) {
                const elapsedMs = Date.now() - new Date(p.last_turns_granted_at).getTime();
                const elapsedHours = Math.floor(elapsedMs / ONE_HOUR_MS);
                if (elapsedHours < 1) continue;
                const newTurns = Math.min(p.turns + elapsedHours * hourlyRate, u.max_turns);
                await setPlayerTurnsAndStamp(p.id, newTurns, client);
                updated++;
            }
        }
        return updated;
    });
    return result ?? 0;
}

/**
 * Hourly planet production: settles every planet that has any colonists
 * assigned. The same per-planet `settlePlanetProduction` helper is invoked
 * by take/leave-colonists handlers so a colos change inside the hour
 * doesn't get billed against the wrong segment.
 */
export async function runProduceCommodities(): Promise<number> {
    const result = await withTransaction(async (client) => {
        const ids = await listPlanetIdsWithColonists(client);
        let updated = 0;
        for (const id of ids) {
            const { produced } = await settlePlanetProduction(id, client);
            if (produced) updated++;
        }
        return updated;
    });
    return result ?? 0;
}

/**
 * Single iteration of the hourly job loop. Add new tasks here as they
 * land. Errors from any one task are logged but don't crash the
 * scheduler.
 */
export async function runHourlyJobs(): Promise<void> {
    try {
        const granted = await runGrantTurns();
        if (granted > 0) console.log(`[hourly] granted turns to ${granted} players`);
    } catch (err) {
        console.error('[hourly] grant-turns failed:', err);
    }
    try {
        const produced = await runProduceCommodities();
        if (produced > 0) console.log(`[hourly] produced commodities on ${produced} planets`);
    } catch (err) {
        console.error('[hourly] produce-commodities failed:', err);
    }
}

let intervalHandle: NodeJS.Timeout | null = null;

/**
 * Start the in-process hourly scheduler. Runs once on boot so any
 * accumulated turns from server downtime are applied immediately, then
 * fires every hour. Idempotent — extra calls are ignored.
 */
export function startHourlyScheduler(): void {
    if (intervalHandle) return;
    void runHourlyJobs();
    intervalHandle = setInterval(() => void runHourlyJobs(), ONE_HOUR_MS);
}

export function stopHourlyScheduler(): void {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
    }
}

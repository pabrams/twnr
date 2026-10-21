import { withTransaction } from '../db/index.js';
import {
    listTurnEnabledUniverses,
    lockPlayersForTurnGrant,
    setPlayerTurnsAndStamp,
} from '../db/queries/turn.js';
import {
    listPlanetIdsWithColonists,
    settlePlanetProduction,
    settlePlanetColonistGrowth,
    promoteDuePlanetBases,
} from '../db/queries/planet.js';
import { listProducingPortIds, settlePortProduction } from '../db/queries/port.js';
import { runAdvancePortConstructions } from './port-construction-advance.js';
import { cleanupExpiredGuests } from './guest-cleanup.js';

const ONE_HOUR_MS = 60 * 60 * 1000;

/** Grant rule must stay in sync with packages/server/scripts/grant-turns.js; tests assert idempotency. */
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

/** Runs hourly but the mechanic is daily: settle only stamps when a whole birth/death accrued, so run frequency doesn't matter. */
export async function runColonistGrowth(): Promise<number> {
    const result = await withTransaction(async (client) => {
        const ids = await listPlanetIdsWithColonists(client);
        let updated = 0;
        for (const id of ids) {
            const { changed } = await settlePlanetColonistGrowth(id, client);
            if (changed) updated++;
        }
        return updated;
    });
    return result ?? 0;
}

export async function runRegeneratePorts(): Promise<number> {
    const result = await withTransaction(async (client) => {
        const ids = await listProducingPortIds(client);
        let updated = 0;
        for (const id of ids) {
            const { produced } = await settlePortProduction(id, client);
            if (produced) updated++;
        }
        return updated;
    });
    return result ?? 0;
}

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
    try {
        const regen = await runRegeneratePorts();
        if (regen > 0) console.log(`[hourly] regenerated commodities on ${regen} ports`);
    } catch (err) {
        console.error('[hourly] regenerate-ports failed:', err);
    }
    try {
        const advanced = await runAdvancePortConstructions();
        if (advanced > 0) console.log(`[hourly] advanced ${advanced} port constructions`);
    } catch (err) {
        console.error('[hourly] advance-port-constructions failed:', err);
    }
    try {
        const grown = await runColonistGrowth();
        if (grown > 0) console.log(`[hourly] colonist growth applied on ${grown} planets`);
    } catch (err) {
        console.error('[hourly] colonist-growth failed:', err);
    }
    try {
        const promoted = await promoteDuePlanetBases();
        if (promoted > 0) console.log(`[hourly] completed ${promoted} base constructions`);
    } catch (err) {
        console.error('[hourly] promote-bases failed:', err);
    }
    try {
        const { deleted } = await cleanupExpiredGuests();
        if (deleted > 0) console.log(`[hourly] cleaned up ${deleted} expired guest accounts`);
    } catch (err) {
        console.error('[hourly] guest-cleanup failed:', err);
    }
}

let intervalHandle: NodeJS.Timeout | null = null;

/** Runs once immediately so turns accumulated during server downtime apply on boot. */
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

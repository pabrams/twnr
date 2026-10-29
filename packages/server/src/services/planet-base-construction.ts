import { pool, withTransaction } from '../db/index.js';
import type { Queryable } from '../db/types.js';
import {
    getPlanetBase,
    completeDueBaseConstruction,
    completeAllDueBaseConstructions,
    type PlanetBaseRow,
    type CompletedBaseConstructionRow,
} from '../db/queries/planet.js';
import { recordGameEvent } from './game-events.js';

async function recordBaseUpgraded(
    completed: CompletedBaseConstructionRow,
    db: Queryable,
): Promise<void> {
    await recordGameEvent(
        completed.universe_id,
        {
            kind: 'base_upgraded',
            planet: { planetId: completed.planet_id, name: completed.planet_name },
            sectorNumber: completed.sector_number,
            level: completed.level,
        },
        db,
    );
}

/** Reads the base after completing any construction that has come due on this planet. */
export async function getCurrentPlanetBase(
    planetId: number,
    db: Queryable = pool,
): Promise<PlanetBaseRow | null> {
    const completed = await completeDueBaseConstruction(planetId, db);
    if (completed) await recordBaseUpgraded(completed, db);
    return getPlanetBase(planetId, db);
}

export async function completeDueBaseConstructions(): Promise<number> {
    const count = await withTransaction(async (client) => {
        const completedRows = await completeAllDueBaseConstructions(client);
        for (const completed of completedRows) {
            await recordBaseUpgraded(completed, client);
        }
        return completedRows.length;
    });
    return count ?? 0;
}

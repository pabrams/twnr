/**
 * Hourly job: advance every port_construction row whose 24h window has
 * elapsed. Each advance attempt looks for a planet in the sector that has
 * enough of all three commodities for the day's drain; if found, deduct and
 * bump `days_completed`. If not, the day skips. Either way, the builder
 * (and clan if owned) is notified via mail.
 *
 * When `days_completed` reaches `days_required`, the row is promoted to a
 * full ports row (player-built ports use fixed-magnitude MCIC + prod=100)
 * and the construction row is deleted.
 */

import {
    PORT_CLASS_ACTIONS,
    PORT_CONSTRUCTION_COSTS,
    PLAYER_BUILT_PORT_MCIC,
    INITIAL_PLAYER_PORT_PRODUCTIVITY,
    dailyDrainFor,
    type PortClass,
    type PriceCommodity,
} from '@twnr/shared';
import { withTransaction } from '../db/index.js';
import {
    listConstructionsDueForAdvance,
    recordConstructionAdvanceAttempt,
    deletePortConstruction,
    insertPlayerBuiltPort,
    type PortConstructionRow,
} from '../db/queries/port.js';
import {
    getPlanetIdsInSectorForUpdate,
    getPlanetCommodityForUpdate,
    updatePlanetCommodity,
} from '../db/queries/planet.js';
import { insertSystemMemo } from '../db/queries/message.js';
import { getClanMembers } from '../db/queries/clan.js';
import type { Queryable } from '../db/types.js';

const SENDER_LABEL = 'StarPort Construction';
const KIND_ADVANCED = 'port_advanced';
const KIND_HALTED = 'port_halted';
const KIND_COMPLETED = 'port_completed';

type DrainReq = { ore: number; org: number; equ: number };

/** Try to deduct the day's drain from a single planet in the sector. Returns
 *  the planet ID + drained amount on success, or null on failure (no planet
 *  in the sector has all three). Uses FOR UPDATE locks. */
async function tryDrainFromPlanets(
    sectorDbId: number,
    drain: DrainReq,
    client: Queryable,
): Promise<{ planetId: number; drained: DrainReq } | null> {
    const planetIds = await getPlanetIdsInSectorForUpdate(sectorDbId, client);
    for (const planetId of planetIds) {
        // Re-fetch each commodity under FOR UPDATE (the helper already locks).
        const [fuel, org, equ] = await Promise.all([
            getPlanetCommodityForUpdate(planetId, 'fuel', client),
            getPlanetCommodityForUpdate(planetId, 'organics', client),
            getPlanetCommodityForUpdate(planetId, 'equipment', client),
        ]);
        if ((fuel ?? 0) >= drain.ore && (org ?? 0) >= drain.org && (equ ?? 0) >= drain.equ) {
            await updatePlanetCommodity(planetId, 'fuel', -drain.ore, client);
            await updatePlanetCommodity(planetId, 'organics', -drain.org, client);
            await updatePlanetCommodity(planetId, 'equipment', -drain.equ, client);
            return { planetId, drained: drain };
        }
    }
    return null;
}

/** Resolve mail recipients: if owned by a clan, all current clan members;
 *  otherwise the original builder. Falls back to builder if a clan is empty
 *  for any reason. */
async function resolveRecipients(row: PortConstructionRow, client: Queryable): Promise<number[]> {
    if (row.owner_clan_id !== null) {
        const members = await getClanMembers(row.owner_clan_id, client);
        if (members.length > 0) return members.map((m) => m.id);
    }
    return row.builder_player_id !== null ? [row.builder_player_id] : [];
}

async function mailAll(
    recipients: number[],
    kind: string,
    body: string,
    client: Queryable,
): Promise<void> {
    for (const rid of recipients) {
        await insertSystemMemo(rid, SENDER_LABEL, kind, body, client);
    }
}

async function promoteToPort(row: PortConstructionRow, client: Queryable): Promise<void> {
    const portClass = row.port_class;
    const actions = PORT_CLASS_ACTIONS[portClass];
    if (!actions) return;

    const max = INITIAL_PLAYER_PORT_PRODUCTIVITY * 10;
    const mcicFor = (c: PriceCommodity) =>
        actions[c] === 'B' ? PLAYER_BUILT_PORT_MCIC[c].B : PLAYER_BUILT_PORT_MCIC[c].S;
    const stockFor = (c: PriceCommodity) => (actions[c] === 'S' ? max : 0);

    await insertPlayerBuiltPort(
        row.sector_id,
        portClass,
        row.port_name,
        { playerId: row.owner_player_id, clanId: row.owner_clan_id },
        {
            fuelMax: max,
            fuelProd: INITIAL_PLAYER_PORT_PRODUCTIVITY,
            fuelMcic: mcicFor('fuel'),
            fuelStock: stockFor('fuel'),
            orgMax: max,
            orgProd: INITIAL_PLAYER_PORT_PRODUCTIVITY,
            orgMcic: mcicFor('organics'),
            orgStock: stockFor('organics'),
            equMax: max,
            equProd: INITIAL_PLAYER_PORT_PRODUCTIVITY,
            equMcic: mcicFor('equipment'),
            equStock: stockFor('equipment'),
        },
        client,
    );
    await deletePortConstruction(row.sector_id, client);
}

/** Run one round of advance attempts. Returns the number of constructions
 *  acted on (advance attempted, halted, or completed). */
export async function runAdvancePortConstructions(): Promise<number> {
    const due = await listConstructionsDueForAdvance();
    let acted = 0;
    for (const row of due) {
        await withTransaction(async (client) => {
            const drain = dailyDrainFor(row.port_class as PortClass);
            const drainReq: DrainReq = {
                ore: drain.ore,
                org: drain.org,
                equ: drain.equ,
            };
            const drained = await tryDrainFromPlanets(row.sector_id, drainReq, client);
            const recipients = await resolveRecipients(row, client);

            if (drained === null) {
                // No planet had enough — day skips.
                await recordConstructionAdvanceAttempt(row.sector_id, false, client);
                const cost = PORT_CONSTRUCTION_COSTS[row.port_class as PortClass];
                const body =
                    `Construction of "${row.port_name}" at sector ${row.sector_number} ` +
                    `paused: no planet in sector has the required ${drainReq.ore} ` +
                    `Fuel Ore, ${drainReq.org} Organics, and ${drainReq.equ} Equipment ` +
                    `for today's progress. Build remains at day ${row.days_completed}/${cost.days}.`;
                await mailAll(recipients, KIND_HALTED, body, client);
                acted++;
                return;
            }

            // Advance the day.
            await recordConstructionAdvanceAttempt(row.sector_id, true, client);
            const newDaysCompleted = row.days_completed + 1;

            if (newDaysCompleted >= row.days_required) {
                // Promote to a live port.
                await promoteToPort({ ...row, days_completed: newDaysCompleted }, client);
                const body =
                    `Your StarPort "${row.port_name}" is complete at sector ${row.sector_number}. ` +
                    `It's now open for business.`;
                await mailAll(recipients, KIND_COMPLETED, body, client);
            } else {
                const body =
                    `Construction of "${row.port_name}" at sector ${row.sector_number} ` +
                    `advanced — day ${newDaysCompleted}/${row.days_required}. ` +
                    `Consumed ${drainReq.ore} Fuel Ore, ${drainReq.org} Organics, ` +
                    `${drainReq.equ} Equipment from a planet in the sector.`;
                await mailAll(recipients, KIND_ADVANCED, body, client);
            }
            acted++;
        });
    }
    return acted;
}

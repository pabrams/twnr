/**
 * Planetary Defense Bastion (PDB / "base") handlers.
 *
 * Triggered by the "B" command on a planet. Three flows:
 *   - No base + not constructing → reply `noBase` with level-1 reqs; client
 *     prompts to start. BuildBase deducts fuel/org/equ (not colos) and
 *     inserts a construction row.
 *   - Constructing → reply `constructing` with start + ETA; client renders
 *     progress and exits back to planet (no menu transition).
 *   - Active base (level >= 1) → reply `exists`; client transitions to
 *     Menu.Base. Lazy promotion via `promotePlanetBaseIfDue`.
 *
 * No mail on completion. Completion is detected lazily when the player
 * checks B again.
 */

import { ServerTag, type BaseLevelRequirement } from '@twnr/shared';
import { players } from '../state/players.js';
import { sendEnvelope, sendError } from '../state/messaging.js';
import { withTransaction, AbortTransaction, pool } from '../db/index.js';
import {
    getPlanetBase,
    promotePlanetBaseIfDue,
    insertPlanetBaseConstruction,
    getPlanetTotalColonists,
    getPlanetClassInfo,
    getPlanetCommodityStockForUpdate,
    updatePlanetCommodity,
} from '../db/queries/planet.js';
import { getOnPlanetId } from '../db/queries/player.js';

function level1Of(reqs: unknown): BaseLevelRequirement | null {
    if (!Array.isArray(reqs) || reqs.length === 0) return null;
    const r = reqs[0] as Record<string, unknown>;
    if (
        typeof r.fuel !== 'number' ||
        typeof r.org !== 'number' ||
        typeof r.equ !== 'number' ||
        typeof r.colos !== 'number' ||
        typeof r.days !== 'number'
    ) {
        return null;
    }
    return {
        fuel: r.fuel,
        org: r.org,
        equ: r.equ,
        colos: r.colos,
        days: r.days,
    };
}

export async function serveBaseInfo(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        sendEnvelope(playerId, {
            type: ServerTag.BaseInfoResult,
            mode: 'error',
            message: 'Not on a planet',
        });
        return;
    }

    // Lazy-promote any in-progress base whose timer has elapsed.
    const base = await promotePlanetBaseIfDue(onPlanetId);

    if (base && base.level >= 1) {
        sendEnvelope(playerId, {
            type: ServerTag.BaseInfoResult,
            mode: 'exists',
            level: base.level,
        });
        return;
    }
    if (base && base.construction_target_level !== null && base.construction_completes_at) {
        sendEnvelope(playerId, {
            type: ServerTag.BaseInfoResult,
            mode: 'constructing',
            targetLevel: base.construction_target_level,
            startedAt: base.construction_started_at?.toISOString() ?? '',
            completesAt: base.construction_completes_at.toISOString(),
        });
        return;
    }

    // No base + not constructing → return level-1 requirements + current stock.
    const classInfo = await getPlanetClassInfo(onPlanetId);
    if (!classInfo) {
        sendEnvelope(playerId, {
            type: ServerTag.BaseInfoResult,
            mode: 'error',
            message: 'Planet type not found',
        });
        return;
    }
    const level1 = level1Of(classInfo.base_requirements);
    if (!level1) {
        sendEnvelope(playerId, {
            type: ServerTag.BaseInfoResult,
            mode: 'error',
            message: 'No level-1 base requirements configured for this planet class',
        });
        return;
    }

    const [stock, totalColos] = await Promise.all([
        pool
            .query<{ fuel: number; organics: number; equipment: number }>(
                `SELECT fuel, organics, equipment FROM planets WHERE id = $1`,
                [onPlanetId],
            )
            .then((r) => r.rows[0] ?? { fuel: 0, organics: 0, equipment: 0 }),
        getPlanetTotalColonists(onPlanetId),
    ]);

    sendEnvelope(playerId, {
        type: ServerTag.BaseInfoResult,
        mode: 'noBase',
        planetClass: classInfo.class,
        planetTypeDisplay: classInfo.display_name ?? classInfo.slug,
        level1: {
            fuel: level1.fuel,
            org: level1.org,
            equ: level1.equ,
            colos: level1.colos,
            days: level1.days,
        },
        planetStock: {
            fuel: stock.fuel,
            org: stock.organics,
            equ: stock.equipment,
            colos: totalColos,
        },
    });
}

export async function serveBuildBase(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        sendEnvelope(playerId, {
            type: ServerTag.BuildBaseResult,
            outcome: 'error',
            message: 'Not on a planet',
        });
        return;
    }

    try {
        const result = await withTransaction(async (client) => {
            // Refuse if a base or in-progress construction already exists.
            const existing = await getPlanetBase(onPlanetId, client);
            if (existing) {
                sendEnvelope(playerId, {
                    type: ServerTag.BuildBaseResult,
                    outcome: 'error',
                    message:
                        existing.level >= 1
                            ? 'A base already exists on this planet'
                            : 'Construction already in progress',
                });
                throw new AbortTransaction();
            }

            const classInfo = await getPlanetClassInfo(onPlanetId, client);
            const level1 = level1Of(classInfo?.base_requirements);
            if (!classInfo || !level1) {
                sendEnvelope(playerId, {
                    type: ServerTag.BuildBaseResult,
                    outcome: 'error',
                    message: 'Planet type missing base requirements',
                });
                throw new AbortTransaction();
            }

            const stock = await getPlanetCommodityStockForUpdate(onPlanetId, client);
            if (!stock) {
                sendEnvelope(playerId, {
                    type: ServerTag.BuildBaseResult,
                    outcome: 'error',
                    message: 'Planet not found',
                });
                throw new AbortTransaction();
            }
            const totalColos = await getPlanetTotalColonists(onPlanetId, client);
            const colosRequired = level1.colos;

            const shortfall: { fuel?: number; org?: number; equ?: number; colos?: number } = {};
            if (stock.fuel < level1.fuel) shortfall.fuel = level1.fuel - stock.fuel;
            if (stock.organics < level1.org) shortfall.org = level1.org - stock.organics;
            if (stock.equipment < level1.equ) shortfall.equ = level1.equ - stock.equipment;
            if (totalColos < colosRequired) shortfall.colos = colosRequired - totalColos;
            if (Object.keys(shortfall).length > 0) {
                sendEnvelope(playerId, {
                    type: ServerTag.BuildBaseResult,
                    outcome: 'error',
                    message: 'Insufficient materials or manpower',
                    shortfall,
                });
                throw new AbortTransaction();
            }

            // Drain commodity stocks (colos stay untouched).
            await updatePlanetCommodity(onPlanetId, 'fuel', -level1.fuel, client);
            await updatePlanetCommodity(onPlanetId, 'organics', -level1.org, client);
            await updatePlanetCommodity(onPlanetId, 'equipment', -level1.equ, client);

            await insertPlanetBaseConstruction(onPlanetId, 1, level1.days, client);

            return { targetLevel: 1, daysRequired: level1.days };
        });

        if (!result) return;

        // Fetch completion time for the reply.
        const base = await getPlanetBase(onPlanetId);
        sendEnvelope(playerId, {
            type: ServerTag.BuildBaseResult,
            outcome: 'started',
            targetLevel: result.targetLevel,
            daysRequired: result.daysRequired,
            completesAt: base?.construction_completes_at?.toISOString() ?? '',
        });
    } catch (err) {
        if (err instanceof AbortTransaction) return;
        console.error('Build base error', err);
        sendError(playerId, 'Internal server error');
    }
}

export async function serveExitBase(playerId: number): Promise<void> {
    sendEnvelope(playerId, { type: ServerTag.ExitBaseResult });
}

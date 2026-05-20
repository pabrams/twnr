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

import { ServerTag, universeConfig, type BaseLevelRequirement } from '@twnr/shared';
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
    getPlanetBaseTreasuryForUpdate,
    adjustPlanetBaseTreasury,
    getPlanetBaseTransporterForUpdate,
    setPlanetBaseTransporterRange,
    getPlanetFuelForUpdate,
} from '../db/queries/planet.js';
import {
    getOnPlanetId,
    getCreditsForUpdate,
    addCredits,
    deductCredits,
    moveToSector,
    markSectorVisited,
    setOnPlanet,
} from '../db/queries/player.js';
import { getGraph } from '../state/graph-cache.js';
import { resolveSectorId } from '../services/sector-lookup.js';
import { moveShipToSector } from '../db/queries/ship.js';
import { checkAndDeductTurns } from '../turn-logic.js';
import { notifyTurnChange } from '../services/notify.js';
import { resolveMinesOnEntry } from '../services/mine-encounter.js';

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

export async function serveTreasuryInfo(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        sendEnvelope(playerId, {
            type: ServerTag.TreasuryInfoResult,
            outcome: 'error',
            message: 'Not on a planet',
        });
        return;
    }
    const base = await promotePlanetBaseIfDue(onPlanetId);
    if (!base || base.level < 1) {
        sendEnvelope(playerId, {
            type: ServerTag.TreasuryInfoResult,
            outcome: 'error',
            message: 'No active base on this planet',
        });
        return;
    }
    const creditsRes = await pool.query<{ credits: number }>(
        'SELECT credits FROM players WHERE id = $1',
        [playerId],
    );
    const credits = creditsRes.rows[0]?.credits ?? 0;
    sendEnvelope(playerId, {
        type: ServerTag.TreasuryInfoResult,
        outcome: 'ok',
        level: base.level,
        treasury: base.treasury,
        credits,
    });
}

export async function serveTreasuryTransfer(
    playerId: number,
    data: { direction: 'to' | 'from'; amount: number },
): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const { direction, amount } = data;
    if (!Number.isInteger(amount) || amount <= 0) {
        sendEnvelope(playerId, {
            type: ServerTag.TreasuryTransferResult,
            outcome: 'error',
            message: 'Amount must be a positive integer',
        });
        return;
    }
    if (direction !== 'to' && direction !== 'from') {
        sendEnvelope(playerId, {
            type: ServerTag.TreasuryTransferResult,
            outcome: 'error',
            message: 'Invalid direction',
        });
        return;
    }

    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        sendEnvelope(playerId, {
            type: ServerTag.TreasuryTransferResult,
            outcome: 'error',
            message: 'Not on a planet',
        });
        return;
    }

    try {
        const result = await withTransaction(async (client) => {
            const base = await getPlanetBaseTreasuryForUpdate(onPlanetId, client);
            if (!base || base.level < 1) {
                sendEnvelope(playerId, {
                    type: ServerTag.TreasuryTransferResult,
                    outcome: 'error',
                    message: 'No active base on this planet',
                });
                throw new AbortTransaction();
            }
            const credits = await getCreditsForUpdate(playerId, client);
            if (credits === undefined) {
                sendEnvelope(playerId, {
                    type: ServerTag.TreasuryTransferResult,
                    outcome: 'error',
                    message: 'Player not found',
                });
                throw new AbortTransaction();
            }

            if (direction === 'to') {
                if (credits < amount) {
                    sendEnvelope(playerId, {
                        type: ServerTag.TreasuryTransferResult,
                        outcome: 'error',
                        message: 'Insufficient credits on hand',
                    });
                    throw new AbortTransaction();
                }
                await deductCredits(playerId, amount, client);
                await adjustPlanetBaseTreasury(onPlanetId, amount, client);
                return { credits: credits - amount, treasury: base.treasury + amount };
            }
            // direction === 'from'
            if (base.treasury < amount) {
                sendEnvelope(playerId, {
                    type: ServerTag.TreasuryTransferResult,
                    outcome: 'error',
                    message: 'Insufficient credits in treasury',
                });
                throw new AbortTransaction();
            }
            await adjustPlanetBaseTreasury(onPlanetId, -amount, client);
            await addCredits(playerId, amount, client);
            return { credits: credits + amount, treasury: base.treasury - amount };
        });
        if (!result) return;

        sendEnvelope(playerId, {
            type: ServerTag.TreasuryTransferResult,
            outcome: 'ok',
            direction,
            amount,
            credits: result.credits,
            treasury: result.treasury,
        });
    } catch (err) {
        if (err instanceof AbortTransaction) return;
        console.error('Treasury transfer error', err);
        sendError(playerId, 'Internal server error');
    }
}

// PlanetBaseRow doesn't include transporter_range — the canonical query has
// not been widened. Read it via the dedicated locking helper instead.
type PlanetBaseRowMaybeTransporter = { transporter_range?: number };

function shortestHopCount(
    warps: Record<number, number[]>,
    from: number,
    to: number,
): number {
    if (from === to) return 0;
    const visited = new Set<number>([from]);
    const queue: { sector: number; hops: number }[] = [{ sector: from, hops: 0 }];
    while (queue.length > 0) {
        const { sector, hops } = queue.shift()!;
        const neighbors = warps[sector] ?? [];
        for (const next of neighbors) {
            if (next === to) return hops + 1;
            if (!visited.has(next)) {
                visited.add(next);
                queue.push({ sector: next, hops: hops + 1 });
            }
        }
    }
    return -1;
}

export async function serveBwarpInfo(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;
    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        sendEnvelope(playerId, {
            type: ServerTag.BwarpInfoResult,
            outcome: 'error',
            message: 'Not on a planet',
        });
        return;
    }
    const base = await promotePlanetBaseIfDue(onPlanetId);
    if (!base || base.level < 1) {
        sendEnvelope(playerId, {
            type: ServerTag.BwarpInfoResult,
            outcome: 'error',
            message: 'No active base on this planet',
        });
        return;
    }
    const range = (base as PlanetBaseRowMaybeTransporter).transporter_range ?? 0;
    if (range < 1) {
        sendEnvelope(playerId, {
            type: ServerTag.BwarpInfoResult,
            outcome: 'notInstalled',
            installCost: universeConfig.bwarpCost,
            initRange: universeConfig.bwarpInitRange,
        });
        return;
    }
    sendEnvelope(playerId, {
        type: ServerTag.BwarpInfoResult,
        outcome: 'installed',
        range,
        upgradeCost: universeConfig.bwarpUpgradeCost,
        fuelPerHop: universeConfig.bwarpFuelPerHop,
    });
}

export async function serveBwarpInstall(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;
    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        sendEnvelope(playerId, {
            type: ServerTag.BwarpInstallResult,
            outcome: 'error',
            message: 'Not on a planet',
        });
        return;
    }
    try {
        const result = await withTransaction(async (client) => {
            const row = await getPlanetBaseTransporterForUpdate(onPlanetId, client);
            if (!row || row.level < 1) {
                sendEnvelope(playerId, {
                    type: ServerTag.BwarpInstallResult,
                    outcome: 'error',
                    message: 'No active base on this planet',
                });
                throw new AbortTransaction();
            }
            if (row.transporter_range >= 1) {
                sendEnvelope(playerId, {
                    type: ServerTag.BwarpInstallResult,
                    outcome: 'error',
                    message: 'Transporter already installed',
                });
                throw new AbortTransaction();
            }
            const credits = await getCreditsForUpdate(playerId, client);
            if (credits === undefined) {
                sendEnvelope(playerId, {
                    type: ServerTag.BwarpInstallResult,
                    outcome: 'error',
                    message: 'Player not found',
                });
                throw new AbortTransaction();
            }
            const cost = universeConfig.bwarpCost;
            if (credits < cost) {
                sendEnvelope(playerId, {
                    type: ServerTag.BwarpInstallResult,
                    outcome: 'error',
                    message: 'Insufficient credits on hand',
                });
                throw new AbortTransaction();
            }
            await deductCredits(playerId, cost, client);
            await setPlanetBaseTransporterRange(onPlanetId, universeConfig.bwarpInitRange, client);
            return { credits: credits - cost, range: universeConfig.bwarpInitRange };
        });
        if (!result) return;
        sendEnvelope(playerId, {
            type: ServerTag.BwarpInstallResult,
            outcome: 'ok',
            range: result.range,
            credits: result.credits,
        });
    } catch (err) {
        if (err instanceof AbortTransaction) return;
        console.error('Bwarp install error', err);
        sendError(playerId, 'Internal server error');
    }
}

export async function serveBwarpUpgrade(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;
    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        sendEnvelope(playerId, {
            type: ServerTag.BwarpUpgradeResult,
            outcome: 'error',
            message: 'Not on a planet',
        });
        return;
    }
    try {
        const result = await withTransaction(async (client) => {
            const row = await getPlanetBaseTransporterForUpdate(onPlanetId, client);
            if (!row || row.level < 1 || row.transporter_range < 1) {
                sendEnvelope(playerId, {
                    type: ServerTag.BwarpUpgradeResult,
                    outcome: 'error',
                    message: 'No transporter to upgrade',
                });
                throw new AbortTransaction();
            }
            const credits = await getCreditsForUpdate(playerId, client);
            if (credits === undefined) {
                sendEnvelope(playerId, {
                    type: ServerTag.BwarpUpgradeResult,
                    outcome: 'error',
                    message: 'Player not found',
                });
                throw new AbortTransaction();
            }
            const cost = universeConfig.bwarpUpgradeCost;
            if (credits < cost) {
                sendEnvelope(playerId, {
                    type: ServerTag.BwarpUpgradeResult,
                    outcome: 'error',
                    message: 'Insufficient credits on hand',
                });
                throw new AbortTransaction();
            }
            await deductCredits(playerId, cost, client);
            const newRange = row.transporter_range + 1;
            await setPlanetBaseTransporterRange(onPlanetId, newRange, client);
            return { credits: credits - cost, range: newRange, treasury: row.treasury, cost };
        });
        if (!result) return;
        sendEnvelope(playerId, {
            type: ServerTag.BwarpUpgradeResult,
            outcome: 'ok',
            range: result.range,
            cost: result.cost,
            credits: result.credits,
            treasury: result.treasury,
        });
    } catch (err) {
        if (err instanceof AbortTransaction) return;
        console.error('Bwarp upgrade error', err);
        sendError(playerId, 'Internal server error');
    }
}

export async function serveBwarpBeam(
    playerId: number,
    data: { targetSector: number; commit: boolean },
): Promise<void> {
    const player = players[playerId];
    if (!player) return;
    const { targetSector, commit } = data;

    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        sendEnvelope(playerId, {
            type: ServerTag.BwarpBeamResult,
            outcome: 'error',
            message: 'Not on a planet',
        });
        return;
    }
    if (!Number.isInteger(targetSector) || targetSector <= 0) {
        sendEnvelope(playerId, {
            type: ServerTag.BwarpBeamResult,
            outcome: 'error',
            message: 'Invalid target sector',
        });
        return;
    }

    if (!commit) {
        const base = await promotePlanetBaseIfDue(onPlanetId);
        const range = (base as PlanetBaseRowMaybeTransporter | null)?.transporter_range ?? 0;
        if (!base || base.level < 1 || range < 1) {
            sendEnvelope(playerId, {
                type: ServerTag.BwarpBeamResult,
                outcome: 'error',
                message: 'No active transporter',
            });
            return;
        }
        const warps = await getGraph(player.universeId);
        const hops = shortestHopCount(warps, player.sector, targetSector);
        if (hops < 0) {
            sendEnvelope(playerId, {
                type: ServerTag.BwarpBeamResult,
                outcome: 'error',
                message: 'No path to target sector',
            });
            return;
        }
        const fuelRes = await pool.query<{ fuel: number }>(
            `SELECT fuel FROM planets WHERE id = $1`,
            [onPlanetId],
        );
        const planetFuel = fuelRes.rows[0]?.fuel ?? 0;
        sendEnvelope(playerId, {
            type: ServerTag.BwarpBeamResult,
            outcome: 'distance',
            targetSector,
            hops,
            range,
            fuelCost: hops * universeConfig.bwarpFuelPerHop,
            planetFuel,
        });
        return;
    }

    try {
        const result = await withTransaction(async (client) => {
            const row = await getPlanetBaseTransporterForUpdate(onPlanetId, client);
            if (!row || row.level < 1 || row.transporter_range < 1) {
                sendEnvelope(playerId, {
                    type: ServerTag.BwarpBeamResult,
                    outcome: 'error',
                    message: 'No active transporter',
                });
                throw new AbortTransaction();
            }
            const warps = await getGraph(player.universeId);
            const hops = shortestHopCount(warps, player.sector, targetSector);
            if (hops < 0) {
                sendEnvelope(playerId, {
                    type: ServerTag.BwarpBeamResult,
                    outcome: 'error',
                    message: 'No path to target sector',
                });
                throw new AbortTransaction();
            }
            if (hops > row.transporter_range) {
                sendEnvelope(playerId, {
                    type: ServerTag.BwarpBeamResult,
                    outcome: 'error',
                    message: 'Target sector out of transporter range',
                });
                throw new AbortTransaction();
            }
            const planetFuel = await getPlanetFuelForUpdate(onPlanetId, client);
            const fuelCost = hops * universeConfig.bwarpFuelPerHop;
            if (planetFuel === undefined || planetFuel < fuelCost) {
                sendEnvelope(playerId, {
                    type: ServerTag.BwarpBeamResult,
                    outcome: 'error',
                    message: 'Insufficient planet fuel for transport',
                });
                throw new AbortTransaction();
            }
            const turnResult = await checkAndDeductTurns(playerId, player.universeId, 1);
            if (!turnResult.allowed) {
                sendEnvelope(playerId, {
                    type: ServerTag.BwarpBeamResult,
                    outcome: 'error',
                    message: 'Insufficient turns',
                });
                throw new AbortTransaction();
            }
            await updatePlanetCommodity(onPlanetId, 'fuel', -fuelCost, client);
            const targetSectorId = await resolveSectorId(targetSector, player.universeId);
            await moveShipToSector(playerId, targetSectorId, client);
            await setOnPlanet(playerId, null, client);
            await moveToSector(playerId, targetSectorId, client);
            await markSectorVisited(playerId, targetSectorId, client);
            return { hops, fuelCost, turnsUsed: turnResult.turnsUsed, targetSectorId };
        });
        if (!result) return;

        player.sector = targetSector;
        player.sectorId = result.targetSectorId;
        if (result.turnsUsed) {
            notifyTurnChange(playerId, result.turnsUsed, 'planetary transporter');
        }
        sendEnvelope(playerId, {
            type: ServerTag.BwarpBeamResult,
            outcome: 'beamed',
            targetSector,
            hops: result.hops,
            fuelUsed: result.fuelCost,
            turnsUsed: result.turnsUsed,
        });
        await resolveMinesOnEntry(playerId);
    } catch (err) {
        if (err instanceof AbortTransaction) return;
        console.error('Bwarp beam error', err);
        sendError(playerId, 'Internal server error');
    }
}

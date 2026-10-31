import {
    ServerTag,
    universeConfig,
    type BaseLevelRequirement,
    type CommandRequest,
} from '@twnr/shared';
import { onlinePlayers } from '../state/players.js';
import { broadcastTo } from '../state/messaging.js';
import { sectorObserverClients } from '../services/sector-activity.js';

import {
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
    getPlanetStock,
    getPlanetFuel,
} from '../db/queries/planet.js';
import {
    getOnPlanetId,
    getCreditsForUpdate,
    addCredits,
    deductCredits,
    moveToSector,
    markSectorVisited,
    setOnPlanet,
    getPlayerCredits,
} from '../db/queries/player.js';
import { getGraph } from '../state/graph-cache.js';
import { resolveSectorId } from '../services/sector-lookup.js';
import { moveShipToSector } from '../db/queries/ship.js';
import { checkAndDeductTurns } from '../turn-logic.js';
import { notifyTurnChange } from '../services/notify.js';
import { resolveMinesOnEntry } from '../services/mine-encounter.js';
import { getCurrentPlanetBase } from '../services/planet-base-construction.js';
import { type CommandResult, abort, runMutation } from './command.js';

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

export async function serveBaseInfo(playerId: number): Promise<CommandResult<'BaseInfo'>> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        return {
            mode: 'error',
            message: 'Not on a planet',
        };
    }

    const base = await getCurrentPlanetBase(onPlanetId);

    if (base && base.level >= 1) {
        return {
            mode: 'exists',
            level: base.level,
        };
    }
    if (base && base.construction_target_level !== null && base.construction_completes_at) {
        return {
            mode: 'constructing',
            targetLevel: base.construction_target_level,
            startedAt: base.construction_started_at?.toISOString() ?? '',
            completesAt: base.construction_completes_at.toISOString(),
        };
    }

    const classInfo = await getPlanetClassInfo(onPlanetId);
    if (!classInfo) {
        return {
            mode: 'error',
            message: 'Planet type not found',
        };
    }
    const level1 = level1Of(classInfo.base_requirements);
    if (!level1) {
        return {
            mode: 'error',
            message: 'No level-1 base requirements configured for this planet class',
        };
    }

    const [stock, totalColos] = await Promise.all([
        getPlanetStock(onPlanetId),
        getPlanetTotalColonists(onPlanetId),
    ]);

    return {
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
    };
}

export async function serveBuildBase(playerId: number): Promise<CommandResult<'BuildBase'>> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        return {
            outcome: 'error',
            message: 'Not on a planet',
        };
    }

    return runMutation(
        'Build base',
        async (client) => {
            const existing = await getCurrentPlanetBase(onPlanetId, client);
            if (existing) {
                throw abort({
                    outcome: 'error',
                    message:
                        existing.level >= 1
                            ? 'A base already exists on this planet'
                            : 'Construction already in progress',
                });
            }

            const classInfo = await getPlanetClassInfo(onPlanetId, client);
            const level1 = level1Of(classInfo?.base_requirements);
            if (!classInfo || !level1) {
                throw abort({
                    outcome: 'error',
                    message: 'Planet type missing base requirements',
                });
            }

            const stock = await getPlanetCommodityStockForUpdate(onPlanetId, client);
            if (!stock) {
                throw abort({
                    outcome: 'error',
                    message: 'Planet not found',
                });
            }
            const totalColos = await getPlanetTotalColonists(onPlanetId, client);
            const colosRequired = level1.colos;

            const shortfall: { fuel?: number; org?: number; equ?: number; colos?: number } = {};
            if (stock.fuel < level1.fuel) shortfall.fuel = level1.fuel - stock.fuel;
            if (stock.organics < level1.org) shortfall.org = level1.org - stock.organics;
            if (stock.equipment < level1.equ) shortfall.equ = level1.equ - stock.equipment;
            if (totalColos < colosRequired) shortfall.colos = colosRequired - totalColos;
            if (Object.keys(shortfall).length > 0) {
                throw abort({
                    outcome: 'error',
                    message: 'Insufficient materials or manpower',
                    shortfall,
                });
            }

            // Colonists are required but not consumed.
            await updatePlanetCommodity(onPlanetId, 'fuel', -level1.fuel, client);
            await updatePlanetCommodity(onPlanetId, 'organics', -level1.org, client);
            await updatePlanetCommodity(onPlanetId, 'equipment', -level1.equ, client);

            await insertPlanetBaseConstruction(onPlanetId, 1, level1.days, client);

            return { targetLevel: 1, daysRequired: level1.days };
        },
        async (result) => {
            const base = await getCurrentPlanetBase(onPlanetId);
            return {
                outcome: 'started',
                targetLevel: result.targetLevel,
                daysRequired: result.daysRequired,
                completesAt: base?.construction_completes_at?.toISOString() ?? '',
            };
        },
    );
}

export function serveExitBase(): CommandResult<'ExitBase'> {
    return {};
}

export async function serveTreasuryInfo(playerId: number): Promise<CommandResult<'TreasuryInfo'>> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        return {
            outcome: 'error',
            message: 'Not on a planet',
        };
    }
    const base = await getCurrentPlanetBase(onPlanetId);
    if (!base || base.level < 1) {
        return {
            outcome: 'error',
            message: 'No active base on this planet',
        };
    }
    const credits = await getPlayerCredits(playerId);
    return {
        outcome: 'ok',
        level: base.level,
        treasury: base.treasury,
        credits,
    };
}

export async function serveTreasuryTransfer(
    playerId: number,
    data: CommandRequest<'TreasuryTransfer'>,
): Promise<CommandResult<'TreasuryTransfer'>> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    const { direction, amount } = data;
    if (!Number.isInteger(amount) || amount <= 0) {
        return {
            outcome: 'error',
            message: 'Amount must be a positive integer',
        };
    }
    if (direction !== 'to' && direction !== 'from') {
        return {
            outcome: 'error',
            message: 'Invalid direction',
        };
    }

    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        return {
            outcome: 'error',
            message: 'Not on a planet',
        };
    }

    return runMutation(
        'Treasury transfer',
        async (client) => {
            const base = await getPlanetBaseTreasuryForUpdate(onPlanetId, client);
            if (!base || base.level < 1) {
                throw abort({
                    outcome: 'error',
                    message: 'No active base on this planet',
                });
            }
            const credits = await getCreditsForUpdate(playerId, client);
            if (credits === undefined) {
                throw abort({
                    outcome: 'error',
                    message: 'Player not found',
                });
            }

            if (direction === 'to') {
                if (credits < amount) {
                    throw abort({
                        outcome: 'error',
                        message: 'Insufficient credits on hand',
                    });
                }
                await deductCredits(playerId, amount, client);
                await adjustPlanetBaseTreasury(onPlanetId, amount, client);
                return { credits: credits - amount, treasury: base.treasury + amount };
            }
            if (base.treasury < amount) {
                throw abort({
                    outcome: 'error',
                    message: 'Insufficient credits in treasury',
                });
            }
            await adjustPlanetBaseTreasury(onPlanetId, -amount, client);
            await addCredits(playerId, amount, client);
            return { credits: credits + amount, treasury: base.treasury - amount };
        },
        (result) => ({
            outcome: 'ok',
            direction,
            amount,
            credits: result.credits,
            treasury: result.treasury,
        }),
    );
}

function shortestHopCount(warps: Record<number, number[]>, from: number, to: number): number {
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

export async function serveBwarpInfo(playerId: number): Promise<CommandResult<'BwarpInfo'>> {
    const player = onlinePlayers[playerId];
    if (!player) return;
    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        return {
            outcome: 'error',
            message: 'Not on a planet',
        };
    }
    const base = await getCurrentPlanetBase(onPlanetId);
    if (!base || base.level < 1) {
        return {
            outcome: 'error',
            message: 'No active base on this planet',
        };
    }
    const range = base.transporter_range;
    if (range < 1) {
        return {
            outcome: 'notInstalled',
            installCost: universeConfig.bwarpCost,
            initRange: universeConfig.bwarpInitRange,
        };
    }
    return {
        outcome: 'installed',
        range,
        upgradeCost: universeConfig.bwarpUpgradeCost,
        fuelPerHop: universeConfig.bwarpFuelPerHop,
    };
}

export async function serveBwarpInstall(playerId: number): Promise<CommandResult<'BwarpInstall'>> {
    const player = onlinePlayers[playerId];
    if (!player) return;
    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        return {
            outcome: 'error',
            message: 'Not on a planet',
        };
    }
    return runMutation(
        'Bwarp install',
        async (client) => {
            const row = await getPlanetBaseTransporterForUpdate(onPlanetId, client);
            if (!row || row.level < 1) {
                throw abort({
                    outcome: 'error',
                    message: 'No active base on this planet',
                });
            }
            if (row.transporter_range >= 1) {
                throw abort({
                    outcome: 'error',
                    message: 'Transporter already installed',
                });
            }
            const credits = await getCreditsForUpdate(playerId, client);
            if (credits === undefined) {
                throw abort({
                    outcome: 'error',
                    message: 'Player not found',
                });
            }
            const cost = universeConfig.bwarpCost;
            if (credits < cost) {
                throw abort({
                    outcome: 'error',
                    message: 'Insufficient credits on hand',
                });
            }
            await deductCredits(playerId, cost, client);
            await setPlanetBaseTransporterRange(onPlanetId, universeConfig.bwarpInitRange, client);
            return { credits: credits - cost, range: universeConfig.bwarpInitRange };
        },
        (result) => ({
            outcome: 'ok',
            range: result.range,
            credits: result.credits,
        }),
    );
}

export async function serveBwarpUpgrade(playerId: number): Promise<CommandResult<'BwarpUpgrade'>> {
    const player = onlinePlayers[playerId];
    if (!player) return;
    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        return {
            outcome: 'error',
            message: 'Not on a planet',
        };
    }
    return runMutation(
        'Bwarp upgrade',
        async (client) => {
            const row = await getPlanetBaseTransporterForUpdate(onPlanetId, client);
            if (!row || row.level < 1 || row.transporter_range < 1) {
                throw abort({
                    outcome: 'error',
                    message: 'No transporter to upgrade',
                });
            }
            const credits = await getCreditsForUpdate(playerId, client);
            if (credits === undefined) {
                throw abort({
                    outcome: 'error',
                    message: 'Player not found',
                });
            }
            const cost = universeConfig.bwarpUpgradeCost;
            if (credits < cost) {
                throw abort({
                    outcome: 'error',
                    message: 'Insufficient credits on hand',
                });
            }
            await deductCredits(playerId, cost, client);
            const newRange = row.transporter_range + 1;
            await setPlanetBaseTransporterRange(onPlanetId, newRange, client);
            return { credits: credits - cost, range: newRange, treasury: row.treasury, cost };
        },
        (result) => ({
            outcome: 'ok',
            range: result.range,
            cost: result.cost,
            credits: result.credits,
            treasury: result.treasury,
        }),
    );
}

export async function serveBwarpBeam(
    playerId: number,
    data: CommandRequest<'BwarpBeam'>,
): Promise<CommandResult<'BwarpBeam'>> {
    const player = onlinePlayers[playerId];
    if (!player) return;
    const { targetSector, commit } = data;

    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        return {
            outcome: 'error',
            message: 'Not on a planet',
        };
    }
    if (!Number.isInteger(targetSector) || targetSector <= 0) {
        return {
            outcome: 'error',
            message: 'Invalid target sector',
        };
    }

    if (!commit) {
        const base = await getCurrentPlanetBase(onPlanetId);
        const range = base?.transporter_range ?? 0;
        if (!base || base.level < 1 || range < 1) {
            return {
                outcome: 'error',
                message: 'No active transporter',
            };
        }
        const warps = await getGraph(player.universeId);
        const hops = shortestHopCount(warps, player.sector, targetSector);
        if (hops < 0) {
            return {
                outcome: 'error',
                message: 'No path to target sector',
            };
        }
        const planetFuel = await getPlanetFuel(onPlanetId);
        return {
            outcome: 'distance',
            targetSector,
            hops,
            range,
            fuelCost: hops * universeConfig.bwarpFuelPerHop,
            planetFuel,
        };
    }

    return runMutation(
        'Bwarp beam',
        async (client) => {
            const row = await getPlanetBaseTransporterForUpdate(onPlanetId, client);
            if (!row || row.level < 1 || row.transporter_range < 1) {
                throw abort({
                    outcome: 'error',
                    message: 'No active transporter',
                });
            }
            const warps = await getGraph(player.universeId);
            const hops = shortestHopCount(warps, player.sector, targetSector);
            if (hops < 0) {
                throw abort({
                    outcome: 'error',
                    message: 'No path to target sector',
                });
            }
            if (hops > row.transporter_range) {
                throw abort({
                    outcome: 'error',
                    message: 'Target sector out of transporter range',
                });
            }
            const planetFuel = await getPlanetFuelForUpdate(onPlanetId, client);
            const fuelCost = hops * universeConfig.bwarpFuelPerHop;
            if (planetFuel === undefined || planetFuel < fuelCost) {
                throw abort({
                    outcome: 'error',
                    message: 'Insufficient planet fuel for transport',
                });
            }
            const turnResult = await checkAndDeductTurns(playerId, player.universeId, 1);
            if (!turnResult.allowed) {
                throw abort({
                    outcome: 'error',
                    message: 'Insufficient turns',
                });
            }
            await updatePlanetCommodity(onPlanetId, 'fuel', -fuelCost, client);
            const targetSectorId = await resolveSectorId(targetSector, player.universeId);
            await moveShipToSector(playerId, targetSectorId, client);
            await setOnPlanet(playerId, null, client);
            await moveToSector(playerId, targetSectorId, client);
            await markSectorVisited(playerId, targetSectorId, client);
            return { hops, fuelCost, turnsUsed: turnResult.turnsUsed, targetSectorId };
        },
        async (result) => {
            player.sector = targetSector;
            player.sectorId = result.targetSectorId;
            broadcastTo(
                {
                    type: ServerTag.PlayerMoved,
                    playerId,
                    playerName: player.name,
                    sector: targetSector,
                    direction: 'in',
                },
                await sectorObserverClients(player.universeId, targetSector, playerId),
            );
            if (result.turnsUsed) {
                notifyTurnChange(playerId, result.turnsUsed, 'planetary transporter');
            }
            await resolveMinesOnEntry(playerId);
            return {
                outcome: 'beamed' as const,
                targetSector,
                hops: result.hops,
                fuelUsed: result.fuelCost,
                turnsUsed: result.turnsUsed,
            };
        },
    );
}

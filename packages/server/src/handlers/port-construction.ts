import {
    PORT_CLASS_ACTIONS,
    PORT_CONSTRUCTION_COSTS,
    dailyDrainFor,
    upgradeUnitCost,
    tradingPercentDisplay,
    portClassTriplet,
    type PortClass,
    type PriceCommodity,
} from '@twnr/shared';
import type { CommandRequest } from '@twnr/shared';
import { onlinePlayers } from '../state/players.js';

import {
    deductCredits,
    adjustReputationAndExperience,
    getPlayerCredits,
    getCreditsForUpdate,
    getCreditsAndClanForUpdate,
} from '../db/queries/player.js';
import {
    getPortAtSector,
    getPortConstructionAtSectorForUpdate,
    insertPortConstruction,
    applyPortUpgrade,
    getPortProductionAtSector,
    getPortUpgradeInfoForUpdate,
} from '../db/queries/port.js';
import { getPlanetIdsInSectorForUpdate } from '../db/queries/planet.js';
import { getSectorDbId } from '../db/queries/sector.js';
import { experienceDeltas, reputationDeltas, scalarDelta } from '../game-config.js';
import { type CommandResult, commandError, abort, runMutation } from './command.js';

export async function serveConstructPortInfo(
    playerId: number,
): Promise<CommandResult<'ConstructPortInfo'>> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    const port = await getPortAtSector(player.sector, player.universeId);
    if (port && port.class !== 0 && port.class !== 9) {
        await serveUpgradePortInfo(playerId);
        return;
    }
    if (port && (port.class === 0 || port.class === 9)) {
        return {
            mode: 'hasPort',
        };
    }

    const sectorDbId = await getSectorDbId(player.sector, player.universeId);
    if (sectorDbId === undefined) {
        return commandError('Sector not found');
    }
    const planetIds = await getPlanetIdsInSectorForUpdate(sectorDbId);
    if (planetIds.length === 0) {
        return {
            mode: 'noPlanet',
        };
    }

    const existing = await getPortConstructionAtSectorForUpdate(player.sector, player.universeId);

    const credits = await getPlayerCredits(playerId);

    const classes = (Object.keys(PORT_CONSTRUCTION_COSTS) as unknown as PortClass[])
        .map((k) => Number(k) as PortClass)
        .sort((a, b) => a - b)
        .map((portClass) => {
            const cost = PORT_CONSTRUCTION_COSTS[portClass];
            const daily = dailyDrainFor(portClass);
            return {
                portClass,
                code: portClassTriplet(portClass) ?? '',
                credits: cost.credits,
                ore: cost.ore,
                org: cost.org,
                equ: cost.equ,
                days: cost.days,
                dailyOre: daily.ore,
                dailyOrg: daily.org,
                dailyEqu: daily.equ,
            };
        });

    return {
        mode: 'build',
        classes,
        initialProductivity: 100,
        credits,
        ...(existing
            ? {
                  existingConstruction: {
                      portClass: existing.port_class,
                      portName: existing.port_name,
                      daysCompleted: existing.days_completed,
                      daysRequired: existing.days_required,
                  },
              }
            : {}),
    };
}

const MAX_PORT_NAME_LEN = 39;

export async function serveBuildPort(
    playerId: number,
    data: CommandRequest<'BuildPort'>,
): Promise<CommandResult<'BuildPort'>> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    const portClass = data.portClass;
    if (!Number.isInteger(portClass) || portClass < 1 || portClass > 8) {
        return {
            outcome: 'error',
            message: 'Class must be 1-8',
        };
    }
    const portName = (data.portName ?? '').trim();
    if (portName.length === 0 || portName.length > MAX_PORT_NAME_LEN) {
        return {
            outcome: 'error',
            message: `Port name must be 1-${MAX_PORT_NAME_LEN} characters`,
        };
    }

    const cost = PORT_CONSTRUCTION_COSTS[portClass as PortClass];

    return runMutation(
        'Build port',
        async (client) => {
            const sectorDbId = await getSectorDbId(player.sector, player.universeId);
            if (sectorDbId === undefined) {
                throw abort({
                    outcome: 'error',
                    message: 'Sector not found',
                });
            }

            const playerRow = await getCreditsAndClanForUpdate(playerId, client);
            if (!playerRow) {
                throw abort({
                    outcome: 'error',
                    message: 'Player not found',
                });
            }
            if (playerRow.credits < cost.credits) {
                throw abort({
                    outcome: 'error',
                    message: 'Insufficient credits',
                });
            }

            const existingPort = await getPortAtSector(player.sector, player.universeId, client);
            if (existingPort) {
                throw abort({
                    outcome: 'error',
                    message: 'A port already exists in this sector',
                });
            }
            const existingBuild = await getPortConstructionAtSectorForUpdate(
                player.sector,
                player.universeId,
                client,
            );
            if (existingBuild) {
                throw abort({
                    outcome: 'error',
                    message: 'Construction already in progress here',
                });
            }
            const planetIds = await getPlanetIdsInSectorForUpdate(sectorDbId, client);
            if (planetIds.length === 0) {
                throw abort({
                    outcome: 'error',
                    message: 'A planet is required in this sector to construct a port',
                });
            }

            await deductCredits(playerId, cost.credits, client);

            const ownerClanId = playerRow.clan_id;
            const ownerPlayerId = ownerClanId === null ? playerId : null;
            await insertPortConstruction(
                sectorDbId,
                {
                    builderPlayerId: playerId,
                    ownerPlayerId,
                    ownerClanId,
                    portClass,
                    portName,
                    daysRequired: cost.days,
                },
                client,
            );

            const xpEntry = experienceDeltas.amountChangeFor.buildPortByClass;
            const repEntry = reputationDeltas.amountChangeFor.buildPortByClass;
            const xpTable = typeof xpEntry === 'object' ? xpEntry : undefined;
            const repTable = typeof repEntry === 'object' ? repEntry : undefined;
            const xp = xpTable?.[String(portClass)] ?? 0;
            const rep = repTable?.[String(portClass)] ?? 0;
            if (xp !== 0 || rep !== 0) {
                await adjustReputationAndExperience(playerId, rep, xp, client);
            }

            return {
                portClass,
                portName,
                daysRequired: cost.days,
                credits: playerRow.credits - cost.credits,
                experienceGained: xp,
                reputationGained: rep,
            };
        },
        (result) => ({
            outcome: 'started',
            ...result,
        }),
    );
}

export async function serveUpgradePortInfo(
    playerId: number,
): Promise<CommandResult<'UpgradePortInfo'>> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    const port = await getPortAtSector(player.sector, player.universeId);
    if (!port || port.class === 0 || port.class === 9) {
        return {
            mode: 'noPort',
        };
    }

    const credits = await getPlayerCredits(playerId);

    const actions = PORT_CLASS_ACTIONS[port.class];
    const commodities: Array<{
        commodity: PriceCommodity;
        action: 'B' | 'S';
        currentProd: number;
        currentMax: number;
        currentStock: number;
        currentTradingPct: number;
        unitCost: number;
    }> = (['fuel', 'organics', 'equipment'] as PriceCommodity[]).map((commodity) => {
        const action = actions[commodity];
        const portRow = port as unknown as Record<string, number>;
        const stockCol = commodity === 'organics' ? 'organics' : commodity;
        const prefix = commodity === 'fuel' ? 'fuel' : commodity === 'organics' ? 'org' : 'equ';
        const stock = portRow[stockCol];
        const max = portRow[`${prefix}_max`];
        return {
            commodity,
            action,
            currentProd: 0,
            currentMax: max,
            currentStock: stock,
            currentTradingPct: tradingPercentDisplay(action, stock, max),
            unitCost: upgradeUnitCost(commodity),
        };
    });

    const prod = await getPortProductionAtSector(player.sector, player.universeId);
    if (prod) {
        commodities[0].currentProd = prod.fuel_prod;
        commodities[1].currentProd = prod.org_prod;
        commodities[2].currentProd = prod.equ_prod;
    }

    return {
        mode: 'upgrade',
        portName: port.name,
        portClass: port.class,
        credits,
        commodities,
    };
}

export async function serveUpgradePort(
    playerId: number,
    data: CommandRequest<'UpgradePort'>,
): Promise<CommandResult<'UpgradePort'>> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    if (
        data.commodity !== 'fuel' &&
        data.commodity !== 'organics' &&
        data.commodity !== 'equipment'
    ) {
        return {
            outcome: 'error',
            message: 'Invalid commodity',
        };
    }
    const units = Number.isInteger(data.units) ? data.units : parseInt(String(data.units), 10);
    if (isNaN(units) || units <= 0) {
        return {
            outcome: 'error',
            message: 'Units must be > 0',
        };
    }

    const unitCost = upgradeUnitCost(data.commodity);
    const totalCost = units * unitCost;

    return runMutation(
        'Upgrade port',
        async (client) => {
            const port = await getPortUpgradeInfoForUpdate(
                player.sector,
                player.universeId,
                client,
            );
            if (!port) {
                throw abort({
                    outcome: 'error',
                    message: 'No port to upgrade in this sector',
                });
            }
            if (port.class === 0 || port.class === 9) {
                throw abort({
                    outcome: 'error',
                    message: 'Cannot upgrade special ports',
                });
            }

            const credits = (await getCreditsForUpdate(playerId, client)) ?? 0;
            if (credits < totalCost) {
                throw abort({
                    outcome: 'error',
                    message: 'Insufficient credits',
                });
            }

            await deductCredits(playerId, totalCost, client);

            await applyPortUpgrade(port.id, data.commodity, units, client);

            const xpDivisor = scalarDelta(experienceDeltas, 'upgradePortCreditsPerXp') || 3000;
            const xp = Math.floor(totalCost / xpDivisor);
            const rep = scalarDelta(reputationDeltas, 'upgradePort');
            if (xp !== 0 || rep !== 0) {
                await adjustReputationAndExperience(playerId, rep, xp, client);
            }

            const prefix =
                data.commodity === 'fuel' ? 'fuel' : data.commodity === 'organics' ? 'org' : 'equ';
            const stockKey = data.commodity as 'fuel' | 'organics' | 'equipment';
            const newProd = port[`${prefix}_prod` as 'fuel_prod' | 'org_prod' | 'equ_prod'] + units;
            const newMax = port[`${prefix}_max` as 'fuel_max' | 'org_max' | 'equ_max'] + units * 10;
            const newStock = port[stockKey] + units * 10;

            return {
                commodity: data.commodity,
                units,
                creditsSpent: totalCost,
                credits: credits - totalCost,
                experienceGained: xp,
                reputationGained: rep,
                newProd,
                newMax,
                newStock,
            };
        },
        (result) => ({
            outcome: 'upgraded',
            ...result,
        }),
    );
}

import {
    ServerTag,
    PORT_CLASS_ACTIONS,
    PORT_CONSTRUCTION_COSTS,
    dailyDrainFor,
    upgradeUnitCost,
    tradingPercentDisplay,
    portClassTriplet,
    type PortClass,
    type PriceCommodity,
} from '@twnr/shared';
import type { BuildPortCommand, UpgradePortCommand } from '@twnr/shared';
import { players } from '../state/players.js';
import { sendEnvelope, sendError } from '../state/messaging.js';
import { AbortTransaction, pool } from '../db/index.js';
import { runMutation } from './run-mutation.js';
import { deductCredits, adjustReputationAndExperience } from '../db/queries/player.js';
import {
    getPortAtSector,
    getPortConstructionAtSectorForUpdate,
    insertPortConstruction,
    applyPortUpgrade,
} from '../db/queries/port.js';
import { getPlanetIdsInSectorForUpdate } from '../db/queries/planet.js';
import { getSectorDbId } from '../db/queries/sector.js';
import { recordCreditChange } from '../services/audit.js';
import { experienceDeltas, reputationDeltas, scalarDelta } from '../game-config.js';

/** Reply to the "O" command: tell the client whether to render the build
 *  table (no port + planet present) or the upgrade table (port exists), or
 *  reject (no port + no planet, can't construct here). */
export async function serveConstructPortInfo(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const port = await getPortAtSector(player.sector, player.universeId);
    if (port && port.class !== 0 && port.class !== 9) {
        // Existing tradable port → upgrade mode.
        await serveUpgradePortInfo(playerId);
        return;
    }
    if (port && (port.class === 0 || port.class === 9)) {
        sendEnvelope(playerId, {
            type: ServerTag.ConstructPortInfoResult,
            mode: 'hasPort',
        });
        return;
    }

    // No port. Need a planet in sector to construct.
    const sectorDbId = await getSectorDbId(player.sector, player.universeId);
    if (sectorDbId === undefined) {
        sendError(playerId, 'Sector not found');
        return;
    }
    const planetIds = await getPlanetIdsInSectorForUpdate(sectorDbId);
    if (planetIds.length === 0) {
        sendEnvelope(playerId, {
            type: ServerTag.ConstructPortInfoResult,
            mode: 'noPlanet',
        });
        return;
    }

    // Check existing construction on this sector.
    const existing = await getPortConstructionAtSectorForUpdate(player.sector, player.universeId);

    const creditsRes = await pool.query<{ credits: number }>(
        'SELECT credits FROM players WHERE id = $1',
        [playerId],
    );
    const credits = creditsRes.rows[0]?.credits ?? 0;

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

    sendEnvelope(playerId, {
        type: ServerTag.ConstructPortInfoResult,
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
    });
}

const MAX_PORT_NAME_LEN = 39;

export async function serveBuildPort(playerId: number, data: BuildPortCommand): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const portClass = data.portClass;
    if (!Number.isInteger(portClass) || portClass < 1 || portClass > 8) {
        sendEnvelope(playerId, {
            type: ServerTag.BuildPortResult,
            outcome: 'error',
            message: 'Class must be 1-8',
        });
        return;
    }
    const portName = (data.portName ?? '').trim();
    if (portName.length === 0 || portName.length > MAX_PORT_NAME_LEN) {
        sendEnvelope(playerId, {
            type: ServerTag.BuildPortResult,
            outcome: 'error',
            message: `Port name must be 1-${MAX_PORT_NAME_LEN} characters`,
        });
        return;
    }

    const cost = PORT_CONSTRUCTION_COSTS[portClass as PortClass];

    await runMutation(
        playerId,
        'Build port',
        async (client) => {
            const sectorDbId = await getSectorDbId(player.sector, player.universeId);
            if (sectorDbId === undefined) {
                sendEnvelope(playerId, {
                    type: ServerTag.BuildPortResult,
                    outcome: 'error',
                    message: 'Sector not found',
                });
                throw new AbortTransaction();
            }

            // Lock player credits + clan_id; reject if already constructing
            // here, port exists, no planet, or insufficient credits.
            const playerRes = await client.query<{ credits: number; clan_id: number | null }>(
                'SELECT credits, clan_id FROM players WHERE id = $1 FOR UPDATE',
                [playerId],
            );
            const playerRow = playerRes.rows[0];
            if (!playerRow) {
                sendEnvelope(playerId, {
                    type: ServerTag.BuildPortResult,
                    outcome: 'error',
                    message: 'Player not found',
                });
                throw new AbortTransaction();
            }
            if (playerRow.credits < cost.credits) {
                sendEnvelope(playerId, {
                    type: ServerTag.BuildPortResult,
                    outcome: 'error',
                    message: 'Insufficient credits',
                });
                throw new AbortTransaction();
            }

            const existingPort = await getPortAtSector(player.sector, player.universeId, client);
            if (existingPort) {
                sendEnvelope(playerId, {
                    type: ServerTag.BuildPortResult,
                    outcome: 'error',
                    message: 'A port already exists in this sector',
                });
                throw new AbortTransaction();
            }
            const existingBuild = await getPortConstructionAtSectorForUpdate(
                player.sector,
                player.universeId,
                client,
            );
            if (existingBuild) {
                sendEnvelope(playerId, {
                    type: ServerTag.BuildPortResult,
                    outcome: 'error',
                    message: 'Construction already in progress here',
                });
                throw new AbortTransaction();
            }
            const planetIds = await getPlanetIdsInSectorForUpdate(sectorDbId, client);
            if (planetIds.length === 0) {
                sendEnvelope(playerId, {
                    type: ServerTag.BuildPortResult,
                    outcome: 'error',
                    message: 'A planet is required in this sector to construct a port',
                });
                throw new AbortTransaction();
            }

            await deductCredits(playerId, cost.credits, client);
            await recordCreditChange(client, {
                playerId,
                actionType: 'build_port',
                delta: -cost.credits,
                prevCredits: playerRow.credits,
                newCredits: playerRow.credits - cost.credits,
                context: { sector: player.sector, portClass, portName },
            });

            // Ownership snapshot: if builder is in a clan, the port belongs
            // to that clan; otherwise to the builder personally.
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
        (result) =>
            sendEnvelope(playerId, {
                type: ServerTag.BuildPortResult,
                outcome: 'started',
                ...result,
            }),
    );
}

export async function serveUpgradePortInfo(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const port = await getPortAtSector(player.sector, player.universeId);
    if (!port || port.class === 0 || port.class === 9) {
        sendEnvelope(playerId, {
            type: ServerTag.UpgradePortInfoResult,
            mode: 'noPort',
        });
        return;
    }

    const creditsRes = await pool.query<{ credits: number }>(
        'SELECT credits FROM players WHERE id = $1',
        [playerId],
    );
    const credits = creditsRes.rows[0]?.credits ?? 0;

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
        // prod isn't returned by getPortAtSector; admin-level lookup needed.
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

    // Patch in productivity from a focused query (getPortAtSector doesn't
    // include prod columns; we need them for the upgrade-info display).
    const prodRes = await pool.query<{
        fuel_prod: number;
        org_prod: number;
        equ_prod: number;
    }>(
        `SELECT p.fuel_prod, p.org_prod, p.equ_prod
         FROM ports p JOIN sectors s ON p.sector_id = s.id
         WHERE s.sector_number = $1 AND s.universe_id = $2`,
        [player.sector, player.universeId],
    );
    if (prodRes.rows[0]) {
        commodities[0].currentProd = prodRes.rows[0].fuel_prod;
        commodities[1].currentProd = prodRes.rows[0].org_prod;
        commodities[2].currentProd = prodRes.rows[0].equ_prod;
    }

    sendEnvelope(playerId, {
        type: ServerTag.UpgradePortInfoResult,
        mode: 'upgrade',
        portName: port.name,
        portClass: port.class,
        credits,
        commodities,
    });
}

export async function serveUpgradePort(playerId: number, data: UpgradePortCommand): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (
        data.commodity !== 'fuel' &&
        data.commodity !== 'organics' &&
        data.commodity !== 'equipment'
    ) {
        sendEnvelope(playerId, {
            type: ServerTag.UpgradePortResult,
            outcome: 'error',
            message: 'Invalid commodity',
        });
        return;
    }
    const units = Number.isInteger(data.units) ? data.units : parseInt(String(data.units), 10);
    if (isNaN(units) || units <= 0) {
        sendEnvelope(playerId, {
            type: ServerTag.UpgradePortResult,
            outcome: 'error',
            message: 'Units must be > 0',
        });
        return;
    }

    const unitCost = upgradeUnitCost(data.commodity);
    const totalCost = units * unitCost;

    await runMutation(
        playerId,
        'Upgrade port',
        async (client) => {
            const portRes = await client.query<{
                id: number;
                class: number;
                fuel_prod: number;
                org_prod: number;
                equ_prod: number;
                fuel_max: number;
                org_max: number;
                equ_max: number;
                fuel: number;
                organics: number;
                equipment: number;
            }>(
                `SELECT p.id, p.class,
                        p.fuel_prod, p.org_prod, p.equ_prod,
                        p.fuel_max, p.org_max, p.equ_max,
                        p.fuel, p.organics, p.equipment
                 FROM ports p JOIN sectors s ON p.sector_id = s.id
                 WHERE s.sector_number = $1 AND s.universe_id = $2
                 FOR UPDATE OF p`,
                [player.sector, player.universeId],
            );
            const port = portRes.rows[0];
            if (!port) {
                sendEnvelope(playerId, {
                    type: ServerTag.UpgradePortResult,
                    outcome: 'error',
                    message: 'No port to upgrade in this sector',
                });
                throw new AbortTransaction();
            }
            if (port.class === 0 || port.class === 9) {
                sendEnvelope(playerId, {
                    type: ServerTag.UpgradePortResult,
                    outcome: 'error',
                    message: 'Cannot upgrade special ports',
                });
                throw new AbortTransaction();
            }

            const credRes = await client.query<{ credits: number }>(
                'SELECT credits FROM players WHERE id = $1 FOR UPDATE',
                [playerId],
            );
            const credits = credRes.rows[0]?.credits ?? 0;
            if (credits < totalCost) {
                sendEnvelope(playerId, {
                    type: ServerTag.UpgradePortResult,
                    outcome: 'error',
                    message: 'Insufficient credits',
                });
                throw new AbortTransaction();
            }

            await deductCredits(playerId, totalCost, client);
            await recordCreditChange(client, {
                playerId,
                actionType: 'upgrade_port',
                delta: -totalCost,
                prevCredits: credits,
                newCredits: credits - totalCost,
                context: {
                    sector: player.sector,
                    commodity: data.commodity,
                    units,
                    unitCost,
                },
            });

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
        (result) =>
            sendEnvelope(playerId, {
                type: ServerTag.UpgradePortResult,
                outcome: 'upgraded',
                ...result,
            }),
    );
}

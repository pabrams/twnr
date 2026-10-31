import {
    ServerTag,
    PORT_CLASS_ACTIONS,
    computeUnitPriceWithXp,
    tradingDisplayed,
    type PriceCommodity,
} from '@twnr/shared';
import type { CommandRequest } from '@twnr/shared';
import { broadcastSectorActivity } from '../services/sector-activity.js';
import { onlinePlayers, getPlayerUniverseId } from '../state/players.js';
import { sendEnvelope, sendError } from '../state/messaging.js';
import { buildSectorDisplayData } from '../services/sector-display.js';
import { isInEncounter } from '../services/encounter.js';
import { AbortTransaction } from '../db/index.js';
import { runMutation } from './run-mutation.js';
import {
    setDocked,
    getCurrentSector,
    deductCredits,
    addCredits,
    adjustReputationAndExperience,
    getPlayerExperience,
} from '../db/queries/player.js';
import {
    getPortAtSector,
    getPortTradeInfoForUpdate,
    adjustPortCommodity,
    getHardwarePricesForUniverse,
    type Commodity,
} from '../db/queries/port.js';
import {
    getShipCargoWithCredits,
    getShipCargoWithCreditsForUpdate,
    getShipInfo,
    incrementShipCommodity,
} from '../db/queries/ship.js';
import { checkAndDeductTurns } from '../turn-logic.js';
import { cargoUsed, formatCargo } from './cargo-utils.js';
import { currentClass0Prices } from '../services/class0-prices.js';
import { getTowingPlayerForShip, clearTowedShip } from '../db/queries/tow.js';
import { getPlayerShipId } from '../db/queries/player.js';
import { experienceDeltas, scalarDelta } from '../game-config.js';
import { notifyTurnChange } from '../services/notify.js';

const EMPTY_CARGO = { fuel: 0, organics: 0, equipment: 0, colonists: 0 };

function buildPortInfoPayload(
    p: {
        name: string;
        class: number;
        fuel: number;
        fuel_max: number;
        fuel_mcic: number;
        organics: number;
        org_max: number;
        org_mcic: number;
        equipment: number;
        equ_max: number;
        equ_mcic: number;
    },
    sectorId: number,
    playerXp: number,
) {
    const actions = PORT_CLASS_ACTIONS[p.class];
    const priceFor = (
        commodity: PriceCommodity,
        stock: number,
        max: number,
        mcic: number,
    ): number => {
        if (!actions) return 0;
        const action = actions[commodity];
        return computeUnitPriceWithXp(commodity, stock, max, mcic, playerXp, action);
    };
    const displayedFor = (commodity: PriceCommodity, stock: number, max: number): number => {
        if (!actions) return 0;
        return tradingDisplayed(actions[commodity], stock, max);
    };
    return {
        type: ServerTag.PortInfoResult,
        sectorId,
        portName: p.name,
        class: p.class,
        fuel: displayedFor('fuel', p.fuel, p.fuel_max),
        fuelMax: p.fuel_max,
        fuelPrice: priceFor('fuel', p.fuel, p.fuel_max, p.fuel_mcic),
        organics: displayedFor('organics', p.organics, p.org_max),
        orgMax: p.org_max,
        orgPrice: priceFor('organics', p.organics, p.org_max, p.org_mcic),
        equipment: displayedFor('equipment', p.equipment, p.equ_max),
        equMax: p.equ_max,
        equPrice: priceFor('equipment', p.equipment, p.equ_max, p.equ_mcic),
    };
}

export async function servePortInfo(
    playerId: number,
    data: CommandRequest<'PortInfo'>,
): Promise<void> {
    const { sectorId } = data;
    if (!Number.isInteger(sectorId) || sectorId <= 0) {
        sendError(playerId, 'Invalid sector ID');
        return;
    }

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    const [p, xp] = await Promise.all([
        getPortAtSector(sectorId, universeId),
        getPlayerExperience(playerId),
    ]);
    if (!p) {
        sendError(playerId, 'No port in this sector');
        return;
    }

    sendEnvelope(playerId, buildPortInfoPayload(p, p.sector_id, xp));
}

export async function serveDock(playerId: number): Promise<void> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    if (player.docked) {
        sendError(playerId, 'Already docked');
        return;
    }

    if (await isInEncounter(playerId)) {
        sendError(playerId, 'Resolve drone encounter first');
        return;
    }

    const [p, cargo, xp] = await Promise.all([
        getPortAtSector(player.sector, player.universeId),
        getShipCargoWithCredits(playerId),
        getPlayerExperience(playerId),
    ]);
    if (!p) {
        sendError(playerId, 'No port in this sector');
        return;
    }

    player.docked = true;
    await setDocked(playerId, true);
    void broadcastSectorActivity(playerId, 'dock', p.name ?? null);

    let freedFromTow = false;
    const shipId = await getPlayerShipId(playerId);
    if (shipId !== null) {
        const towerId = await getTowingPlayerForShip(shipId);
        if (towerId !== null && towerId !== playerId) {
            await clearTowedShip(towerId);
            freedFromTow = true;
            if (onlinePlayers[towerId]) {
                sendEnvelope(towerId, {
                    type: ServerTag.TowReleasedAlert,
                    towedName: player.name,
                });
            }
        }
    }

    const cargoOut = cargo ? formatCargo(cargo) : EMPTY_CARGO;
    const emptyHolds = Math.max(0, (cargo?.cargo_limit ?? 0) - cargoUsed(cargoOut));
    const credits = cargo?.credits ?? 0;

    const portInfoPayload = buildPortInfoPayload(p, player.sector, xp);

    if (p.class === 0) {
        const ship = await getShipInfo(playerId);
        await sendEnvelope(playerId, {
            type: ServerTag.DockResult,
            docked: true,
            port: portInfoPayload,
            credits,
            cargo: cargoOut,
            emptyHolds,
            ...(freedFromTow ? ({ freedFromTow: true } as const) : {}),
            shipInfo: ship
                ? {
                      shipTypeName: ship.ship_type_name,
                      drones: ship.drones,
                      maxDrones: ship.max_drones,
                      shields: ship.shields,
                      maxShields: ship.max_shields,
                      holds: ship.holds,
                      maxHolds: ship.max_holds,
                  }
                : undefined,
            class0Prices: currentClass0Prices(),
        });
        return;
    }

    await sendEnvelope(playerId, {
        type: ServerTag.DockResult,
        docked: true,
        port: portInfoPayload,
        credits,
        cargo: cargoOut,
        emptyHolds,
        ...(freedFromTow ? ({ freedFromTow: true } as const) : {}),
    });
}

async function undockPlayer(playerId: number): Promise<void> {
    const player = onlinePlayers[playerId];
    if (!player) return;
    player.docked = false;
    player.at_starbase = false;
    await setDocked(playerId, false);
    const undockedPort = await getPortAtSector(player.sector, player.universeId);
    void broadcastSectorActivity(playerId, 'undock', undockedPort?.name ?? null);
    const { clearHaggleSession } = await import('./port-haggle.js');
    clearHaggleSession(playerId);
    const sectorData = await buildSectorDisplayData(playerId);
    if (!sectorData) return;
    await sendEnvelope(playerId, {
        type: ServerTag.UndockResult,
        outcome: 'success',
        ...sectorData,
    });
}

export async function serveUndock(playerId: number): Promise<void> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    if (!player.docked) {
        sendEnvelope(playerId, {
            type: ServerTag.UndockResult,
            outcome: 'error',
            message: 'Not docked',
        });
        return;
    }

    await undockPlayer(playerId);
}

const MAX_COL: Record<Commodity, 'fuel_max' | 'org_max' | 'equ_max'> = {
    fuel: 'fuel_max',
    organics: 'org_max',
    equipment: 'equ_max',
};
const MCIC_COL: Record<Commodity, 'fuel_mcic' | 'org_mcic' | 'equ_mcic'> = {
    fuel: 'fuel_mcic',
    organics: 'org_mcic',
    equipment: 'equ_mcic',
};

export async function servePortTransaction(
    playerId: number,
    data: CommandRequest<'PortTransaction'>,
): Promise<void> {
    const { good, quantity, action } = data;
    if (good !== 'fuel' && good !== 'organics' && good !== 'equipment') {
        sendError(playerId, 'Invalid good');
        return;
    }
    const col = good as Commodity;

    if (action !== 'buy' && action !== 'sell') {
        sendError(playerId, 'Invalid action');
        return;
    }

    const qty = Number.isInteger(quantity) ? quantity : parseInt(String(quantity), 10);
    if (isNaN(qty) || qty <= 0) {
        sendError(playerId, 'Invalid quantity');
        return;
    }

    const player = onlinePlayers[playerId];
    if (!player) return;
    if (!player.docked) {
        sendError(playerId, 'You must dock at the port to trade');
        return;
    }
    const universeId = player.universeId;

    await runMutation(
        playerId,
        'Trade',
        async (client) => {
            const currentSector = await getCurrentSector(playerId, client);
            if (currentSector === undefined) {
                sendError(playerId, 'Player not found');
                throw new AbortTransaction();
            }

            const port = await getPortTradeInfoForUpdate(currentSector, universeId, client);
            if (!port) {
                sendError(playerId, 'No port in this sector');
                throw new AbortTransaction();
            }

            const portActions = PORT_CLASS_ACTIONS[port.class];
            if (
                !portActions ||
                (action === 'buy' && portActions[col] !== 'S') ||
                (action === 'sell' && portActions[col] !== 'B')
            ) {
                sendError(playerId, 'Port does not trade this commodity');
                throw new AbortTransaction();
            }

            // Read xp inside the tx so an earlier trade's xp award affects this trade's pricing.
            const xp = await getPlayerExperience(playerId, client);

            // `stock` is physical inventory: a buying port's capacity is max−stock, a selling port's is stock.
            const stock = port[col];
            const max = port[MAX_COL[col]];
            const mcic = port[MCIC_COL[col]];
            const price = computeUnitPriceWithXp(col, stock, max, mcic, xp, portActions[col]);

            const cargo = await getShipCargoWithCreditsForUpdate(playerId, client);
            if (!cargo) {
                sendError(playerId, 'Player not found');
                throw new AbortTransaction();
            }

            if (action === 'buy') {
                const turnResult = await checkAndDeductTurns(playerId, universeId, 1, client);
                if (!turnResult.allowed) {
                    sendError(playerId, 'Insufficient turns');
                    throw new AbortTransaction();
                }

                const cost = qty * price;
                if (cargo.credits < cost) {
                    sendError(playerId, 'Insufficient credits');
                    throw new AbortTransaction();
                }
                if (stock < qty) {
                    sendError(playerId, 'Insufficient port inventory');
                    throw new AbortTransaction();
                }
                if (cargoUsed(cargo) + qty > cargo.cargo_limit) {
                    sendError(playerId, 'Insufficient cargo holds');
                    throw new AbortTransaction();
                }

                await adjustPortCommodity(port.port_id, col, -qty, client);
                await incrementShipCommodity(playerId, col, qty, client);
                await deductCredits(playerId, cost, client);

                const xpDelta = scalarDelta(experienceDeltas, 'portTrade');
                if (xpDelta !== 0) {
                    await adjustReputationAndExperience(playerId, 0, xpDelta, client);
                }

                cargo[col] += qty;
                cargo.credits -= cost;
                const used = cargoUsed(cargo);
                return {
                    credits: cargo.credits,
                    cargo: formatCargo(cargo),
                    emptyHolds: Math.max(0, cargo.cargo_limit - used),
                    turnsUsed: turnResult.turnsUsed,
                };
            }

            if (cargo[col] < qty) {
                sendError(playerId, 'Insufficient cargo');
                throw new AbortTransaction();
            }
            if (stock + qty > max) {
                sendError(playerId, 'Port cannot buy that many');
                throw new AbortTransaction();
            }

            const revenue = qty * price;
            await adjustPortCommodity(port.port_id, col, qty, client);
            await incrementShipCommodity(playerId, col, -qty, client);
            await addCredits(playerId, revenue, client);

            const xpDelta = scalarDelta(experienceDeltas, 'portTrade');
            if (xpDelta !== 0) {
                await adjustReputationAndExperience(playerId, 0, xpDelta, client);
            }

            cargo[col] -= qty;
            cargo.credits += revenue;
            const used = cargoUsed(cargo);
            return {
                credits: cargo.credits,
                cargo: formatCargo(cargo),
                emptyHolds: Math.max(0, cargo.cargo_limit - used),
            };
        },
        (result) => {
            const xpDelta = scalarDelta(experienceDeltas, 'portTrade');
            if ('turnsUsed' in result && result.turnsUsed) {
                notifyTurnChange(playerId, result.turnsUsed, 'trading');
            }

            sendEnvelope(playerId, {
                type: ServerTag.PortTransactionResult,
                credits: result.credits,
                cargo: result.cargo,
                emptyHolds: result.emptyHolds,
                ...('turnsUsed' in result ? { turnsUsed: result.turnsUsed } : {}),
                expDelta: xpDelta,
                repDelta: 0,
            });
        },
    );
}

export async function serveDockStarbase(playerId: number): Promise<void> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    if (await isInEncounter(playerId)) {
        sendError(playerId, 'Resolve drone encounter first');
        return;
    }

    const starbasePort = await getPortAtSector(player.sector, player.universeId);
    if (starbasePort?.class !== 9) {
        sendError(playerId, 'Starbase not found in this sector');
        return;
    }

    const wasDocked = player.docked;
    player.at_starbase = true;
    if (!wasDocked) {
        player.docked = true;
        await setDocked(playerId, true);
        void broadcastSectorActivity(playerId, 'dock', starbasePort.name ?? null);
    }

    const [priceRows, ship] = await Promise.all([
        getHardwarePricesForUniverse(player.universeId),
        getShipInfo(playerId),
    ]);
    await sendEnvelope(playerId, {
        type: ServerTag.DockStarbaseResult,
        prices: priceRows.map((r) => ({ name: r.name, label: r.label, price: r.price })),
        class0Prices: currentClass0Prices(),
        credits: ship?.credits,
        shipInfo: ship
            ? {
                  shipTypeName: ship.ship_type_name,
                  drones: ship.drones,
                  maxDrones: ship.max_drones,
                  shields: ship.shields,
                  maxShields: ship.max_shields,
                  holds: ship.holds,
                  maxHolds: ship.max_holds,
              }
            : undefined,
    });
}

export async function serveLeaveStarbase(playerId: number): Promise<void> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    if (!player.at_starbase) {
        sendError(playerId, 'Not at Starbase');
        return;
    }

    player.at_starbase = false;
    if (player.docked) {
        player.docked = false;
        await setDocked(playerId, false);
        const starbasePort = await getPortAtSector(player.sector, player.universeId);
        void broadcastSectorActivity(playerId, 'undock', starbasePort?.name ?? null);
    }

    const sectorData = await buildSectorDisplayData(playerId);
    if (!sectorData) return;
    await sendEnvelope(playerId, { type: ServerTag.LeaveStarbaseResult, ...sectorData });
}

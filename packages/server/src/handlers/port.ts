import { ServerTag, PORT_CLASS_ACTIONS } from '@twnr/shared';
import type { PortInfoCommand, PortTransactionCommand } from '@twnr/shared';
import { players, getPlayerUniverseId } from '../state/players.js';
import { sendEnvelope, sendError } from '../state/messaging.js';
import { buildSectorDisplayData } from '../services/sector-display.js';
import { isInEncounter } from '../services/encounter.js';
import { withTransaction, AbortTransaction } from '../db/index.js';
import { setDocked, getCurrentSector, deductCredits, addCredits } from '../db/queries/player.js';
import {
    getPortAtSector,
    getPortClassAtSector,
    getPortTradeInfoForUpdate,
    decrementPortCommodity,
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
import { recordCreditChange } from '../services/audit.js';

const EMPTY_CARGO = { fuel: 0, organics: 0, equipment: 0, colonists: 0 };

function buildPortInfoPayload(
    p: {
        name: string;
        class: number;
        fuel: number;
        fuel_max: number;
        fuel_price: number;
        organics: number;
        org_max: number;
        org_price: number;
        equipment: number;
        equ_max: number;
        equ_price: number;
    },
    sectorId: number,
) {
    return {
        type: ServerTag.PortInfoResult,
        sectorId,
        portName: p.name,
        class: p.class,
        fuel: p.fuel,
        fuelMax: p.fuel_max,
        fuelPrice: p.fuel_price,
        organics: p.organics,
        orgMax: p.org_max,
        orgPrice: p.org_price,
        equipment: p.equipment,
        equMax: p.equ_max,
        equPrice: p.equ_price,
    };
}

export async function handlePortInfo(playerId: number, data: PortInfoCommand): Promise<void> {
    const { sectorId } = data;
    if (!Number.isInteger(sectorId) || sectorId <= 0) {
        sendError(playerId, 'Invalid sector ID');
        return;
    }

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    const p = await getPortAtSector(sectorId, universeId);
    if (!p) {
        sendError(playerId, 'No port in this sector');
        return;
    }

    sendEnvelope(playerId, buildPortInfoPayload(p, p.sector_id));
}

export async function handleDock(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (player.docked) {
        sendError(playerId, 'Already docked');
        return;
    }

    if (await isInEncounter(playerId)) {
        sendError(playerId, 'Resolve drone encounter first');
        return;
    }

    const [p, cargo] = await Promise.all([
        getPortAtSector(player.sector, player.universeId),
        getShipCargoWithCredits(playerId),
    ]);
    if (!p) {
        sendError(playerId, 'No port in this sector');
        return;
    }

    player.docked = true;
    await setDocked(playerId, true);

    const cargoOut = cargo ? formatCargo(cargo) : EMPTY_CARGO;
    const emptyHolds = Math.max(0, (cargo?.cargo_limit ?? 0) - cargoUsed(cargoOut));
    const credits = cargo?.credits ?? 0;

    const portInfoPayload = buildPortInfoPayload(p, player.sector);

    if (p.class === 0) {
        const ship = await getShipInfo(playerId);
        await sendEnvelope(playerId, {
            type: ServerTag.DockResult,
            docked: true,
            port: portInfoPayload,
            credits,
            cargo: cargoOut,
            emptyHolds,
            shipInfo: ship
                ? {
                      shipName: ship.ship_name,
                      drones: ship.drones,
                      maxDrones: ship.max_drones,
                      shields: ship.shields,
                      maxShields: ship.max_shields,
                      holds: ship.holds,
                      maxHolds: ship.max_holds,
                  }
                : undefined,
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
    });
}

async function undockPlayer(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;
    player.docked = false;
    await setDocked(playerId, false);
    const sectorData = await buildSectorDisplayData(playerId);
    if (!sectorData) return;
    await sendEnvelope(playerId, {
        type: ServerTag.UndockResult,
        outcome: 'success',
        ...sectorData,
    });
}

export async function handleUndock(playerId: number): Promise<void> {
    const player = players[playerId];
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

export async function handlePortTransaction(
    playerId: number,
    data: PortTransactionCommand,
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

    const player = players[playerId];
    if (!player) return;
    const universeId = player.universeId;

    const priceColMap: Record<Commodity, 'fuel_price' | 'org_price' | 'equ_price'> = {
        fuel: 'fuel_price',
        organics: 'org_price',
        equipment: 'equ_price',
    };

    try {
        const result = await withTransaction(async (client) => {
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

            const price: number = port[priceColMap[col]];

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
                if (port[col] < qty) {
                    sendError(playerId, 'Insufficient port inventory');
                    throw new AbortTransaction();
                }
                if (cargoUsed(cargo) + qty > cargo.cargo_limit) {
                    sendError(playerId, 'Insufficient cargo holds');
                    throw new AbortTransaction();
                }

                await decrementPortCommodity(port.port_id, col, qty, client);
                await incrementShipCommodity(playerId, col, qty, client);
                await deductCredits(playerId, cost, client);
                await recordCreditChange(client, {
                    playerId,
                    actionType: 'port_buy',
                    delta: -cost,
                    prevCredits: cargo.credits,
                    newCredits: cargo.credits - cost,
                    context: {
                        sector: currentSector,
                        commodity: col,
                        qty,
                        unitPrice: price,
                        portClass: port.class,
                    },
                });

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

            // sell
            if (cargo[col] < qty) {
                sendError(playerId, 'Insufficient cargo');
                throw new AbortTransaction();
            }
            if (port[col] < qty) {
                sendError(playerId, 'Port cannot buy that many');
                throw new AbortTransaction();
            }

            const revenue = qty * price;
            await decrementPortCommodity(port.port_id, col, qty, client);
            await incrementShipCommodity(playerId, col, -qty, client);
            await addCredits(playerId, revenue, client);
            await recordCreditChange(client, {
                playerId,
                actionType: 'port_sell',
                delta: revenue,
                prevCredits: cargo.credits,
                newCredits: cargo.credits + revenue,
                context: {
                    sector: currentSector,
                    commodity: col,
                    qty,
                    unitPrice: price,
                    portClass: port.class,
                },
            });

            cargo[col] -= qty;
            cargo.credits += revenue;
            const used = cargoUsed(cargo);
            return {
                credits: cargo.credits,
                cargo: formatCargo(cargo),
                emptyHolds: Math.max(0, cargo.cargo_limit - used),
            };
        });

        if (!result) return;

        sendEnvelope(playerId, {
            type: ServerTag.PortTransactionResult,
            credits: result.credits,
            cargo: result.cargo,
            emptyHolds: result.emptyHolds,
            ...('turnsUsed' in result ? { turnsUsed: result.turnsUsed } : {}),
        });
    } catch (err) {
        console.error('Trade error', err);
        sendError(playerId, 'Internal server error');
    }
}

export async function handleDockStarbase(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (await isInEncounter(playerId)) {
        sendError(playerId, 'Resolve drone encounter first');
        return;
    }

    const portClass = await getPortClassAtSector(player.sector, player.universeId);
    if (portClass !== 9) {
        sendError(playerId, 'Starbase not found in this sector');
        return;
    }

    player.at_starbase = true;

    const [priceRows, ship] = await Promise.all([
        getHardwarePricesForUniverse(player.universeId),
        getShipInfo(playerId),
    ]);
    await sendEnvelope(playerId, {
        type: ServerTag.DockStarbaseResult,
        prices: priceRows.map((r) => ({ name: r.name, label: r.label, price: r.price })),
        credits: ship?.credits,
        shipInfo: ship
            ? {
                  shipName: ship.ship_name,
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

export async function handleLeaveStarbase(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (!player.at_starbase) {
        sendError(playerId, 'Not at Starbase');
        return;
    }

    player.at_starbase = false;

    const sectorData = await buildSectorDisplayData(playerId);
    if (!sectorData) return;
    await sendEnvelope(playerId, { type: ServerTag.LeaveStarbaseResult, ...sectorData });
}

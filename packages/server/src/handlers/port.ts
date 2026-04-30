import { ServerMsgType, PORT_CLASS_ACTIONS } from '@twnr/shared';
import { players, getPlayerUniverseId } from '../state/players.js';
import { sendEnvelope, sendError } from '../state/messaging.js';
import { portName } from '../domain/port-classes.js';
import { buildSectorDisplayData } from '../services/sector-display.js';
import { withTransaction, AbortTransaction } from '../db/index.js';
import { setDocked, getCurrentSector, deductCredits, addCredits } from '../db/queries/player.js';
import {
    getPortAtSector,
    getPortClassAtSector,
    getPortInventoryAtSector,
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

const EMPTY_CARGO = { fuel: 0, organics: 0, equipment: 0, colonists: 0 };

function buildPortInfoPayload(
    p: {
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
        type: ServerMsgType.PortInfoResult,
        sectorId,
        portName: portName(sectorId),
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

export async function handlePortInfo(playerId: number, sectorId: number): Promise<void> {
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

    if (player.pendingEncounter) {
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
        await sendEnvelope(
            playerId,
            {
                type: ServerMsgType.DockResult,
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
            },
            'class0',
        );
        return;
    }

    sendEnvelope(playerId, {
        type: ServerMsgType.DockResult,
        docked: true,
        port: portInfoPayload,
        credits,
        cargo: cargoOut,
        emptyHolds,
    });

    // Build trade steps from port class actions
    const actions = PORT_CLASS_ACTIONS[p.class];
    if (!actions) {
        await undockPlayer(playerId);
        return;
    }

    const COMMODITIES: { key: Commodity; label: string; price: number }[] = [
        { key: 'fuel', label: 'Fuel', price: p.fuel_price },
        { key: 'organics', label: 'Organics', price: p.org_price },
        { key: 'equipment', label: 'Equipment', price: p.equ_price },
    ];

    const steps: import('../state/players.js').TradeStep[] = [];
    for (const c of COMMODITIES) {
        const dir = actions[c.key];
        if (!dir) continue;
        steps.push({
            commodity: c.key,
            commodityLabel: c.label,
            action: dir === 'S' ? 'buy' : 'sell',
            price: c.price,
        });
    }

    player.tradeState = { steps, stepIndex: 0, prompted: new Set() };
    await advanceTradeFlow(playerId);
}

async function undockPlayer(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;
    player.docked = false;
    player.tradeState = undefined;
    await setDocked(playerId, false);
    const sectorData = await buildSectorDisplayData(playerId);
    if (!sectorData) return;
    await sendEnvelope(
        playerId,
        { type: ServerMsgType.UndockResult, outcome: 'success', ...sectorData },
        'sector',
    );
}

async function advanceTradeFlow(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player?.tradeState) {
        await undockPlayer(playerId);
        return;
    }

    const { steps, prompted } = player.tradeState;

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (prompted.has(step.commodity)) continue;

        const [port, cargo] = await Promise.all([
            getPortInventoryAtSector(player.sector, player.universeId),
            getShipCargoWithCredits(playerId),
        ]);
        if (!port || !cargo) {
            await undockPlayer(playerId);
            return;
        }

        const used = cargoUsed(cargo);
        const emptyHolds = Math.max(0, cargo.cargo_limit - used);
        const portTrading = port[step.commodity];
        const onBoard = cargo[step.commodity];
        const maxQty =
            step.action === 'buy'
                ? Math.min(emptyHolds, portTrading)
                : Math.min(onBoard, portTrading);

        if (maxQty <= 0) continue;

        player.tradeState.stepIndex = i;
        prompted.add(step.commodity);
        await sendEnvelope(
            playerId,
            {
                type: ServerMsgType.TradePrompt,
                commodity: step.commodity,
                commodityLabel: step.commodityLabel,
                action: step.action,
                portTrading,
                onBoard,
                maxQty,
                price: step.price,
                credits: cargo.credits,
                emptyHolds,
            },
            'tradeQty',
        );
        return;
    }

    // Nothing to prompt. If we never prompted anything, show the "nothing to trade" message.
    if (prompted.size === 0) {
        sendEnvelope(playerId, {
            type: ServerMsgType.TradeSkipped,
            reason: 'noTrade',
        });
    }
    await undockPlayer(playerId);
}

export async function handleTradeResponse(playerId: number, quantity: number): Promise<void> {
    const player = players[playerId];
    if (!player?.tradeState) {
        sendError(playerId, 'Not in a trade flow');
        return;
    }

    const step = player.tradeState.steps[player.tradeState.stepIndex];
    if (!step) {
        await advanceTradeFlow(playerId);
        return;
    }

    if (quantity === 0) {
        player.tradeState.stepIndex++;
        await advanceTradeFlow(playerId);
        return;
    }

    const [port, cargo] = await Promise.all([
        getPortInventoryAtSector(player.sector, player.universeId),
        getShipCargoWithCredits(playerId),
    ]);
    if (!port || !cargo) {
        await undockPlayer(playerId);
        return;
    }

    const used = cargoUsed(cargo);
    const emptyHolds = Math.max(0, cargo.cargo_limit - used);
    const portTrading = port[step.commodity];
    const onBoard = cargo[step.commodity];
    const maxQty =
        step.action === 'buy' ? Math.min(emptyHolds, portTrading) : Math.min(onBoard, portTrading);

    // -1 = accept default (maxQty)
    const clampedQty = quantity < 0 ? maxQty : Math.min(quantity, maxQty);
    if (clampedQty <= 0) {
        player.tradeState.stepIndex++;
        await advanceTradeFlow(playerId);
        return;
    }

    const totalPrice = clampedQty * step.price;
    player.tradeState.pendingQty = clampedQty;

    await sendEnvelope(
        playerId,
        {
            type: ServerMsgType.TradeConfirmPrompt,
            commodity: step.commodity,
            commodityLabel: step.commodityLabel,
            action: step.action,
            quantity: clampedQty,
            totalPrice,
        },
        'tradeConfirm',
    );
}

export async function handleTradeConfirmResponse(
    playerId: number,
    confirmed: boolean,
): Promise<void> {
    const player = players[playerId];
    if (!player?.tradeState) {
        sendError(playerId, 'Not in a trade flow');
        return;
    }

    const step = player.tradeState.steps[player.tradeState.stepIndex];
    const qty = player.tradeState.pendingQty ?? 0;

    if (!confirmed || !step || qty <= 0) {
        player.tradeState.pendingQty = undefined;
        player.tradeState.stepIndex++;
        await advanceTradeFlow(playerId);
        return;
    }

    type TradeOutcome =
        | { kind: 'advance' }
        | { kind: 'undock' }
        | {
              kind: 'skip';
              reason:
                  | 'insufficientTurns'
                  | 'insufficientCredits'
                  | 'insufficientPortInventory'
                  | 'insufficientCargoHolds'
                  | 'insufficientCargo'
                  | 'portCannotBuy';
          }
        | {
              kind: 'complete';
              credits: number;
              cargo: { fuel: number; organics: number; equipment: number; colonists: number };
              emptyHolds: number;
              turnsUsed?: number;
          };

    let outcome: TradeOutcome = { kind: 'advance' } as TradeOutcome;

    try {
        await withTransaction(async (client) => {
            const currentSector = await getCurrentSector(playerId, client);
            if (currentSector === undefined) {
                outcome = { kind: 'advance' };
                return;
            }

            const port = await getPortTradeInfoForUpdate(currentSector, player.universeId, client);
            if (!port) {
                outcome = { kind: 'undock' };
                return;
            }

            const cargo = await getShipCargoWithCreditsForUpdate(playerId, client);
            if (!cargo) {
                outcome = { kind: 'undock' };
                return;
            }

            const col = step.commodity;
            const price = step.price;

            if (step.action === 'buy') {
                const turnResult = await checkAndDeductTurns(
                    playerId,
                    player.universeId,
                    1,
                    client,
                );
                if (!turnResult.allowed) {
                    outcome = { kind: 'skip', reason: 'insufficientTurns' };
                    return;
                }

                const cost = qty * price;
                if (cargo.credits < cost) {
                    outcome = { kind: 'skip', reason: 'insufficientCredits' };
                    throw new AbortTransaction();
                }
                if (port[col] < qty) {
                    outcome = { kind: 'skip', reason: 'insufficientPortInventory' };
                    throw new AbortTransaction();
                }
                const used = cargoUsed(cargo);
                if (used + qty > cargo.cargo_limit) {
                    outcome = { kind: 'skip', reason: 'insufficientCargoHolds' };
                    throw new AbortTransaction();
                }

                await decrementPortCommodity(port.port_id, col, qty, client);
                await incrementShipCommodity(playerId, col, qty, client);
                await deductCredits(playerId, cost, client);

                cargo[col] += qty;
                cargo.credits -= cost;
                const usedAfter = cargoUsed(cargo);
                outcome = {
                    kind: 'complete',
                    credits: cargo.credits,
                    cargo: formatCargo(cargo),
                    emptyHolds: Math.max(0, cargo.cargo_limit - usedAfter),
                    turnsUsed: turnResult.turnsUsed,
                };
            } else {
                if (cargo[col] < qty) {
                    outcome = { kind: 'skip', reason: 'insufficientCargo' };
                    return;
                }
                if (port[col] < qty) {
                    outcome = { kind: 'skip', reason: 'portCannotBuy' };
                    return;
                }

                const revenue = qty * price;
                await decrementPortCommodity(port.port_id, col, qty, client);
                await incrementShipCommodity(playerId, col, -qty, client);
                await addCredits(playerId, revenue, client);

                cargo[col] -= qty;
                cargo.credits += revenue;
                const usedAfter = cargoUsed(cargo);
                outcome = {
                    kind: 'complete',
                    credits: cargo.credits,
                    cargo: formatCargo(cargo),
                    emptyHolds: Math.max(0, cargo.cargo_limit - usedAfter),
                };
            }
        });
    } catch (err) {
        console.error('Trade error', err);
        sendError(playerId, 'Internal server error');
        await undockPlayer(playerId);
        return;
    }

    switch (outcome.kind) {
        case 'advance':
            player.tradeState.stepIndex++;
            await advanceTradeFlow(playerId);
            return;
        case 'undock':
            await undockPlayer(playerId);
            return;
        case 'skip':
            sendEnvelope(playerId, {
                type: ServerMsgType.TradeSkipped,
                reason: outcome.reason,
            });
            player.tradeState.pendingQty = undefined;
            player.tradeState.stepIndex++;
            await advanceTradeFlow(playerId);
            return;
        case 'complete':
            sendEnvelope(playerId, {
                type: ServerMsgType.TradeComplete,
                credits: outcome.credits,
                cargo: outcome.cargo,
                emptyHolds: outcome.emptyHolds,
                ...(outcome.turnsUsed !== undefined ? { turnsUsed: outcome.turnsUsed } : {}),
            });
            player.tradeState.pendingQty = undefined;
            player.tradeState.stepIndex++;
            await advanceTradeFlow(playerId);
            return;
    }
}

export async function handleUndock(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (!player.docked) {
        sendEnvelope(playerId, {
            type: ServerMsgType.UndockResult,
            outcome: 'error',
            message: 'Not docked',
        });
        return;
    }

    await undockPlayer(playerId);
}

export async function handlePortTransaction(
    playerId: number,
    good: string,
    quantity: number,
    action: string,
): Promise<void> {
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
            type: ServerMsgType.PortTransactionResult,
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

    if (player.pendingEncounter) {
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
    await sendEnvelope(
        playerId,
        {
            type: ServerMsgType.DockStarbaseResult,
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
        },
        'starbase',
    );
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
    await sendEnvelope(
        playerId,
        { type: ServerMsgType.LeaveStarbaseResult, ...sectorData },
        'sector',
    );
}

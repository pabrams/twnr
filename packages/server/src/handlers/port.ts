import { ServerMsgType } from '@twnr/shared';
import {
    players,
    sendEnvelope,
    getPlayerUniverseId,
    PORT_CLASS_ACTIONS,
    portName,
    buildSectorDisplayData,
    setPlayerMenu,
} from '../game-state.js';
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
    incrementShipCommodity,
} from '../db/queries/ship.js';
import { checkAndDeductTurns } from '../turn-logic.js';

export async function handlePortInfo(playerId: number, sectorId: number): Promise<void> {
    if (!Number.isInteger(sectorId) || sectorId <= 0) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Invalid sector ID' });
        return;
    }

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    const p = await getPortAtSector(sectorId, universeId);
    if (!p) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'No port in this sector' });
        return;
    }

    sendEnvelope(playerId, {
        type: ServerMsgType.PortInfoResult,
        sectorId: p.sector_id,
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
    });
}

export async function handleDock(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (player.docked) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Already docked' });
        return;
    }

    if (player.pendingEncounter) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'Resolve drone encounter first',
        });
        return;
    }

    const [p, cargo] = await Promise.all([
        getPortAtSector(player.sector, player.universeId),
        getShipCargoWithCredits(playerId),
    ]);
    if (!p) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'No port in this sector' });
        return;
    }

    player.docked = true;
    await setDocked(playerId, true);

    const used =
        (cargo?.fuel ?? 0) +
        (cargo?.organics ?? 0) +
        (cargo?.equipment ?? 0) +
        (cargo?.colonists ?? 0);
    const emptyHolds = Math.max(0, (cargo?.cargo_limit ?? 0) - used);
    const credits = cargo?.credits ?? 0;

    const portInfoPayload = {
        type: ServerMsgType.PortInfoResult,
        sectorId: player.sector,
        portName: portName(player.sector),
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

    // Class 0 ports use a different flow
    if (p.class === 0) {
        await setPlayerMenu(playerId, 'class0');
        sendEnvelope(playerId, {
            type: ServerMsgType.DockResult,
            docked: true,
            port: portInfoPayload,
            credits,
            cargo: {
                fuel: cargo?.fuel ?? 0,
                organics: cargo?.organics ?? 0,
                equipment: cargo?.equipment ?? 0,
                colonists: cargo?.colonists ?? 0,
            },
            emptyHolds,
        });
        return;
    }

    sendEnvelope(playerId, {
        type: ServerMsgType.DockResult,
        docked: true,
        port: portInfoPayload,
        credits,
        cargo: {
            fuel: cargo?.fuel ?? 0,
            organics: cargo?.organics ?? 0,
            equipment: cargo?.equipment ?? 0,
            colonists: cargo?.colonists ?? 0,
        },
        emptyHolds,
    });

    // Build trade steps from port class actions
    const actions = PORT_CLASS_ACTIONS[p.class];
    if (!actions) {
        await undockPlayer(playerId);
        return;
    }

    const COMMODITIES: { key: Commodity; label: string; priceCol: string }[] = [
        { key: 'fuel', label: 'Fuel', priceCol: 'fuel_price' },
        { key: 'organics', label: 'Organics', priceCol: 'org_price' },
        { key: 'equipment', label: 'Equipment', priceCol: 'equ_price' },
    ];

    const steps: import('../game-state.js').TradeStep[] = [];
    for (const c of COMMODITIES) {
        const dir = actions[c.key];
        if (!dir) continue;
        const action = dir === 'S' ? ('buy' as const) : ('sell' as const);
        steps.push({
            commodity: c.key,
            commodityLabel: c.label,
            action,
            price: (p as unknown as Record<string, number>)[c.priceCol],
        });
    }

    player.tradeState = { steps, stepIndex: 0 };
    await advanceTradeFlow(playerId);
}

async function undockPlayer(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;
    player.docked = false;
    player.tradeState = undefined;
    await setDocked(playerId, false);
    await setPlayerMenu(playerId, 'sector');
    const sectorData = await buildSectorDisplayData(playerId);
    if (!sectorData) return;
    sendEnvelope(playerId, { type: ServerMsgType.UndockResult, outcome: 'success', ...sectorData });
}

async function advanceTradeFlow(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player?.tradeState) {
        await undockPlayer(playerId);
        return;
    }

    const { steps } = player.tradeState;

    while (player.tradeState.stepIndex < steps.length) {
        const step = steps[player.tradeState.stepIndex];

        const [port, cargo] = await Promise.all([
            getPortInventoryAtSector(player.sector, player.universeId),
            getShipCargoWithCredits(playerId),
        ]);
        if (!port || !cargo) {
            await undockPlayer(playerId);
            return;
        }

        const used = cargo.fuel + cargo.organics + cargo.equipment + cargo.colonists;
        const emptyHolds = Math.max(0, cargo.cargo_limit - used);
        const portTrading = port[step.commodity];
        const onBoard = cargo[step.commodity];
        const maxQty =
            step.action === 'buy'
                ? Math.min(emptyHolds, portTrading)
                : Math.min(onBoard, portTrading);

        if (maxQty > 0) {
            await setPlayerMenu(playerId, 'tradeQty');
            sendEnvelope(playerId, {
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
            });
            return;
        }

        player.tradeState.stepIndex++;
    }

    sendEnvelope(playerId, {
        type: ServerMsgType.TradeSkipped,
        reason: 'noTrade',
    });
    await undockPlayer(playerId);
}

export async function handleTradeResponse(playerId: number, quantity: number): Promise<void> {
    const player = players[playerId];
    if (!player?.tradeState) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Not in a trade flow' });
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

    const used = cargo.fuel + cargo.organics + cargo.equipment + cargo.colonists;
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

    await setPlayerMenu(playerId, 'tradeConfirm');
    sendEnvelope(playerId, {
        type: ServerMsgType.TradeConfirmPrompt,
        commodity: step.commodity,
        commodityLabel: step.commodityLabel,
        action: step.action,
        quantity: clampedQty,
        totalPrice,
    });
}

export async function handleTradeConfirmResponse(
    playerId: number,
    confirmed: boolean,
): Promise<void> {
    const player = players[playerId];
    if (!player?.tradeState) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Not in a trade flow' });
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
                const used = cargo.fuel + cargo.organics + cargo.equipment + cargo.colonists;
                if (used + qty > cargo.cargo_limit) {
                    outcome = { kind: 'skip', reason: 'insufficientCargoHolds' };
                    throw new AbortTransaction();
                }

                await decrementPortCommodity(port.port_id, col, qty, client);
                await incrementShipCommodity(playerId, col, qty, client);
                await deductCredits(playerId, cost, client);

                cargo[col] += qty;
                cargo.credits -= cost;
                const usedAfter = cargo.fuel + cargo.organics + cargo.equipment + cargo.colonists;
                outcome = {
                    kind: 'complete',
                    credits: cargo.credits,
                    cargo: {
                        fuel: cargo.fuel,
                        organics: cargo.organics,
                        equipment: cargo.equipment,
                        colonists: cargo.colonists,
                    },
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
                const usedAfter = cargo.fuel + cargo.organics + cargo.equipment + cargo.colonists;
                outcome = {
                    kind: 'complete',
                    credits: cargo.credits,
                    cargo: {
                        fuel: cargo.fuel,
                        organics: cargo.organics,
                        equipment: cargo.equipment,
                        colonists: cargo.colonists,
                    },
                    emptyHolds: Math.max(0, cargo.cargo_limit - usedAfter),
                };
            }
        });
    } catch (err) {
        console.error('Trade error', err);
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Internal server error' });
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
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Invalid good' });
        return;
    }
    const col = good as Commodity;

    if (action !== 'buy' && action !== 'sell') {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Invalid action' });
        return;
    }

    const qty = Number.isInteger(quantity) ? quantity : parseInt(String(quantity), 10);
    if (isNaN(qty) || qty <= 0) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Invalid quantity' });
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
                sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Player not found' });
                throw new AbortTransaction();
            }

            const port = await getPortTradeInfoForUpdate(currentSector, universeId, client);
            if (!port) {
                sendEnvelope(playerId, {
                    type: ServerMsgType.Error,
                    message: 'No port in this sector',
                });
                throw new AbortTransaction();
            }

            const portActions = PORT_CLASS_ACTIONS[port.class];
            if (
                !portActions ||
                (action === 'buy' && portActions[col] !== 'S') ||
                (action === 'sell' && portActions[col] !== 'B')
            ) {
                sendEnvelope(playerId, {
                    type: ServerMsgType.Error,
                    message: 'Port does not trade this commodity',
                });
                throw new AbortTransaction();
            }

            const price: number = port[priceColMap[col]];

            const cargo = await getShipCargoWithCreditsForUpdate(playerId, client);
            if (!cargo) {
                sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Player not found' });
                throw new AbortTransaction();
            }

            if (action === 'buy') {
                const turnResult = await checkAndDeductTurns(playerId, universeId, 1, client);
                if (!turnResult.allowed) {
                    sendEnvelope(playerId, {
                        type: ServerMsgType.Error,
                        message: 'Insufficient turns',
                    });
                    throw new AbortTransaction();
                }

                const cost = qty * price;
                if (cargo.credits < cost) {
                    sendEnvelope(playerId, {
                        type: ServerMsgType.Error,
                        message: 'Insufficient credits',
                    });
                    throw new AbortTransaction();
                }
                if (port[col] < qty) {
                    sendEnvelope(playerId, {
                        type: ServerMsgType.Error,
                        message: 'Insufficient port inventory',
                    });
                    throw new AbortTransaction();
                }
                if (
                    cargo.fuel + cargo.organics + cargo.equipment + cargo.colonists + qty >
                    cargo.cargo_limit
                ) {
                    sendEnvelope(playerId, {
                        type: ServerMsgType.Error,
                        message: 'Insufficient cargo holds',
                    });
                    throw new AbortTransaction();
                }

                await decrementPortCommodity(port.port_id, col, qty, client);
                await incrementShipCommodity(playerId, col, qty, client);
                await deductCredits(playerId, cost, client);

                cargo[col] += qty;
                cargo.credits -= cost;
                const used = cargo.fuel + cargo.organics + cargo.equipment + cargo.colonists;
                return {
                    credits: cargo.credits,
                    cargo: {
                        fuel: cargo.fuel,
                        organics: cargo.organics,
                        equipment: cargo.equipment,
                        colonists: cargo.colonists,
                    },
                    emptyHolds: Math.max(0, cargo.cargo_limit - used),
                    turnsUsed: turnResult.turnsUsed,
                };
            }

            // sell
            if (cargo[col] < qty) {
                sendEnvelope(playerId, {
                    type: ServerMsgType.Error,
                    message: 'Insufficient cargo',
                });
                throw new AbortTransaction();
            }
            if (port[col] < qty) {
                sendEnvelope(playerId, {
                    type: ServerMsgType.Error,
                    message: 'Port cannot buy that many',
                });
                throw new AbortTransaction();
            }

            const revenue = qty * price;
            await decrementPortCommodity(port.port_id, col, qty, client);
            await incrementShipCommodity(playerId, col, -qty, client);
            await addCredits(playerId, revenue, client);

            cargo[col] -= qty;
            cargo.credits += revenue;
            const used = cargo.fuel + cargo.organics + cargo.equipment + cargo.colonists;
            return {
                credits: cargo.credits,
                cargo: {
                    fuel: cargo.fuel,
                    organics: cargo.organics,
                    equipment: cargo.equipment,
                    colonists: cargo.colonists,
                },
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
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Internal server error' });
    }
}

export async function handleDockStarbase(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (player.pendingEncounter) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'Resolve drone encounter first',
        });
        return;
    }

    const portClass = await getPortClassAtSector(player.sector, player.universeId);
    if (portClass !== 9) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'Starbase not found in this sector',
        });
        return;
    }

    player.at_starbase = true;
    await setPlayerMenu(playerId, 'starbase');

    const priceRows = await getHardwarePricesForUniverse(player.universeId);
    sendEnvelope(playerId, {
        type: ServerMsgType.DockStarbaseResult,
        prices: priceRows.map((r) => ({ name: r.name, label: r.label, price: r.price })),
    });
}

export async function handleLeaveStarbase(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (!player.at_starbase) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Not at Starbase' });
        return;
    }

    player.at_starbase = false;
    await setPlayerMenu(playerId, 'sector');

    const sectorData = await buildSectorDisplayData(playerId);
    if (!sectorData) return;
    sendEnvelope(playerId, {
        type: ServerMsgType.LeaveStarbaseResult,
        ...sectorData,
    });
}

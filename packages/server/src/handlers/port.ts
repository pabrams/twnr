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
import { pool } from '../db/index.js';
import type { HardwarePriceRow } from '../db/types.js';
import { setDocked, getCurrentSector } from '../db/queries/player.js';
import { checkAndDeductTurns } from '../turn-logic.js';

export async function handlePortInfo(playerId: number, sectorId: number): Promise<void> {
    if (!Number.isInteger(sectorId) || sectorId <= 0) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Invalid sector ID' });
        return;
    }

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    const portRes = await pool.query(
        `SELECT s.sector_number as sector_id, p.class, p.fuel, p.fuel_max, p.fuel_price, p.organics, p.org_max, p.org_price, p.equipment, p.equ_max, p.equ_price
         FROM ports p JOIN sectors s ON p.sector_id = s.id
         WHERE s.sector_number = $1 AND s.universe_id = $2`,
        [sectorId, universeId],
    );
    if (portRes.rows.length === 0) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'No port in this sector' });
        return;
    }

    const p = portRes.rows[0];
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

    const [portRes, cargoRes] = await Promise.all([
        pool.query(
            `SELECT p.class, p.fuel, p.fuel_max, p.fuel_price, p.organics, p.org_max, p.org_price, p.equipment, p.equ_max, p.equ_price
             FROM ports p JOIN sectors s ON p.sector_id = s.id
             WHERE s.sector_number = $1 AND s.universe_id = $2`,
            [player.sector, player.universeId],
        ),
        pool.query(
            `SELECT s.fuel, s.organics, s.equipment, s.colonists, s.holds as cargo_limit, pl.credits
             FROM players pl JOIN ships s ON pl.ship_id = s.id
             WHERE pl.id = $1`,
            [playerId],
        ),
    ]);
    if (portRes.rows.length === 0) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'No port in this sector' });
        return;
    }

    player.docked = true;
    await setDocked(playerId, true);

    const p = portRes.rows[0];
    const cargo = cargoRes.rows[0];

    // Class 0 ports use a different flow
    if (p.class === 0) {
        await setPlayerMenu(playerId, 'class0');
        sendEnvelope(playerId, {
            type: ServerMsgType.DockResult,
            docked: true,
            port: {
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
            },
            credits: cargo?.credits ?? 0,
            cargo: {
                fuel: cargo?.fuel ?? 0,
                organics: cargo?.organics ?? 0,
                equipment: cargo?.equipment ?? 0,
                colonists: cargo?.colonists ?? 0,
            },
            emptyHolds: Math.max(
                0,
                (cargo?.cargo_limit ?? 0) -
                    (cargo?.fuel ?? 0) -
                    (cargo?.organics ?? 0) -
                    (cargo?.equipment ?? 0) -
                    (cargo?.colonists ?? 0),
            ),
        });
        return;
    }

    // Trading ports: send commerce report then build server-side trade sequence
    const used =
        (cargo?.fuel ?? 0) +
        (cargo?.organics ?? 0) +
        (cargo?.equipment ?? 0) +
        (cargo?.colonists ?? 0);
    const emptyHolds = Math.max(0, (cargo?.cargo_limit ?? 0) - used);
    const credits = cargo?.credits ?? 0;

    sendEnvelope(playerId, {
        type: ServerMsgType.DockResult,
        docked: true,
        port: {
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
        },
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

    const COMMODITIES: {
        key: 'fuel' | 'organics' | 'equipment';
        label: string;
        priceCol: string;
    }[] = [
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
            price: p[c.priceCol],
        });
    }

    player.tradeState = { steps, stepIndex: 0 };
    await advanceTradeFlow(playerId);
}

/** Shared helper to undock a player and return them to the sector. */
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

/** Advance to the next tradeable commodity, or undock if done. */
async function advanceTradeFlow(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player?.tradeState) {
        await undockPlayer(playerId);
        return;
    }

    const { steps } = player.tradeState;

    // Find the next step that has something to trade
    while (player.tradeState.stepIndex < steps.length) {
        const step = steps[player.tradeState.stepIndex];

        // Re-fetch current state (another player may have traded)
        const [portRes, cargoRes] = await Promise.all([
            pool.query(
                `SELECT p.fuel, p.organics, p.equipment FROM ports p JOIN sectors s ON p.sector_id = s.id
                 WHERE s.sector_number = $1 AND s.universe_id = $2`,
                [player.sector, player.universeId],
            ),
            pool.query(
                `SELECT s.fuel, s.organics, s.equipment, s.colonists, s.holds as cargo_limit, pl.credits
                 FROM players pl JOIN ships s ON pl.ship_id = s.id WHERE pl.id = $1`,
                [playerId],
            ),
        ]);
        if (portRes.rows.length === 0 || cargoRes.rows.length === 0) {
            await undockPlayer(playerId);
            return;
        }

        const port = portRes.rows[0];
        const cargo = cargoRes.rows[0];
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

        // Nothing to trade for this commodity, skip
        player.tradeState.stepIndex++;
    }

    // All commodities exhausted — notify and undock
    sendEnvelope(playerId, {
        type: ServerMsgType.TradeSkipped,
        reason: "You don't have anything they want, and they don't have anything you need.",
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
        // Skip this commodity
        player.tradeState.stepIndex++;
        await advanceTradeFlow(playerId);
        return;
    }

    // Re-fetch to compute actual max (concurrency safe)
    const [portRes, cargoRes] = await Promise.all([
        pool.query(
            `SELECT p.fuel, p.organics, p.equipment FROM ports p JOIN sectors s ON p.sector_id = s.id
             WHERE s.sector_number = $1 AND s.universe_id = $2`,
            [player.sector, player.universeId],
        ),
        pool.query(
            `SELECT s.fuel, s.organics, s.equipment, s.colonists, s.holds as cargo_limit, pl.credits
             FROM players pl JOIN ships s ON pl.ship_id = s.id WHERE pl.id = $1`,
            [playerId],
        ),
    ]);
    const port = portRes.rows[0];
    const cargo = cargoRes.rows[0];
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
        // Declined or invalid — skip to next commodity
        player.tradeState.pendingQty = undefined;
        player.tradeState.stepIndex++;
        await advanceTradeFlow(playerId);
        return;
    }

    // Execute the trade (reuses existing handlePortTransaction logic inline)
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const currentSector = await getCurrentSector(playerId, client);
        if (currentSector === undefined) {
            await client.query('ROLLBACK');
            player.tradeState.stepIndex++;
            await advanceTradeFlow(playerId);
            return;
        }

        const portRes = await client.query(
            `SELECT p.id as port_id, p.class, p.fuel, p.fuel_price, p.organics, p.org_price, p.equipment, p.equ_price
             FROM ports p JOIN sectors s ON p.sector_id = s.id
             WHERE s.sector_number = $1 AND s.universe_id = $2 FOR UPDATE OF p`,
            [currentSector, player.universeId],
        );
        const port = portRes.rows[0];
        if (!port) {
            await client.query('ROLLBACK');
            await undockPlayer(playerId);
            return;
        }

        const cargoRes = await client.query(
            `SELECT s.fuel, s.organics, s.equipment, s.colonists, p.credits, s.holds as cargo_limit
             FROM players p JOIN ships s ON p.ship_id = s.id WHERE p.id = $1 FOR UPDATE OF s, p`,
            [playerId],
        );
        const cargo = cargoRes.rows[0];
        if (!cargo) {
            await client.query('ROLLBACK');
            await undockPlayer(playerId);
            return;
        }

        const col = step.commodity;
        const price = step.price;

        if (step.action === 'buy') {
            const turnResult = await checkAndDeductTurns(playerId, player.universeId, 1, client);
            if (!turnResult.allowed) {
                await client.query('ROLLBACK');
                sendEnvelope(playerId, {
                    type: ServerMsgType.TradeSkipped,
                    reason: 'Insufficient turns',
                });
                player.tradeState.pendingQty = undefined;
                player.tradeState.stepIndex++;
                await advanceTradeFlow(playerId);
                return;
            }

            const cost = qty * price;
            if (cargo.credits < cost) {
                await client.query('ROLLBACK');
                sendEnvelope(playerId, {
                    type: ServerMsgType.TradeSkipped,
                    reason: 'Insufficient credits',
                });
                player.tradeState.pendingQty = undefined;
                player.tradeState.stepIndex++;
                await advanceTradeFlow(playerId);
                return;
            }
            if (port[col] < qty) {
                await client.query('ROLLBACK');
                sendEnvelope(playerId, {
                    type: ServerMsgType.TradeSkipped,
                    reason: 'Insufficient port inventory',
                });
                player.tradeState.pendingQty = undefined;
                player.tradeState.stepIndex++;
                await advanceTradeFlow(playerId);
                return;
            }
            const used = cargo.fuel + cargo.organics + cargo.equipment + cargo.colonists;
            if (used + qty > cargo.cargo_limit) {
                await client.query('ROLLBACK');
                sendEnvelope(playerId, {
                    type: ServerMsgType.TradeSkipped,
                    reason: 'Insufficient cargo holds',
                });
                player.tradeState.pendingQty = undefined;
                player.tradeState.stepIndex++;
                await advanceTradeFlow(playerId);
                return;
            }

            await client.query(`UPDATE ports SET ${col} = ${col} - $1 WHERE id = $2`, [
                qty,
                port.port_id,
            ]);
            await client.query(
                `UPDATE ships SET ${col} = ${col} + $1 WHERE id = (SELECT ship_id FROM players WHERE id = $2)`,
                [qty, playerId],
            );
            await client.query('UPDATE players SET credits = credits - $1 WHERE id = $2', [
                cost,
                playerId,
            ]);
            await client.query('COMMIT');

            cargo[col] += qty;
            cargo.credits -= cost;
            const usedAfter = cargo.fuel + cargo.organics + cargo.equipment + cargo.colonists;
            sendEnvelope(playerId, {
                type: ServerMsgType.TradeComplete,
                credits: cargo.credits,
                cargo: {
                    fuel: cargo.fuel,
                    organics: cargo.organics,
                    equipment: cargo.equipment,
                    colonists: cargo.colonists,
                },
                emptyHolds: Math.max(0, cargo.cargo_limit - usedAfter),
                turnsUsed: turnResult.turnsUsed,
            });
        } else {
            // Sell
            if (cargo[col] < qty) {
                await client.query('ROLLBACK');
                sendEnvelope(playerId, {
                    type: ServerMsgType.TradeSkipped,
                    reason: 'Insufficient cargo',
                });
                player.tradeState.pendingQty = undefined;
                player.tradeState.stepIndex++;
                await advanceTradeFlow(playerId);
                return;
            }
            if (port[col] < qty) {
                await client.query('ROLLBACK');
                sendEnvelope(playerId, {
                    type: ServerMsgType.TradeSkipped,
                    reason: 'Port cannot buy that many',
                });
                player.tradeState.pendingQty = undefined;
                player.tradeState.stepIndex++;
                await advanceTradeFlow(playerId);
                return;
            }

            const revenue = qty * price;
            await client.query(`UPDATE ports SET ${col} = ${col} - $1 WHERE id = $2`, [
                qty,
                port.port_id,
            ]);
            await client.query(
                `UPDATE ships SET ${col} = ${col} - $1 WHERE id = (SELECT ship_id FROM players WHERE id = $2)`,
                [qty, playerId],
            );
            await client.query('UPDATE players SET credits = credits + $1 WHERE id = $2', [
                revenue,
                playerId,
            ]);
            await client.query('COMMIT');

            cargo[col] -= qty;
            cargo.credits += revenue;
            const usedAfter = cargo.fuel + cargo.organics + cargo.equipment + cargo.colonists;
            sendEnvelope(playerId, {
                type: ServerMsgType.TradeComplete,
                credits: cargo.credits,
                cargo: {
                    fuel: cargo.fuel,
                    organics: cargo.organics,
                    equipment: cargo.equipment,
                    colonists: cargo.colonists,
                },
                emptyHolds: Math.max(0, cargo.cargo_limit - usedAfter),
            });
        }

        // Advance to next commodity
        player.tradeState.pendingQty = undefined;
        player.tradeState.stepIndex++;
        await advanceTradeFlow(playerId);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Trade error', err);
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Internal server error' });
        await undockPlayer(playerId);
    } finally {
        client.release();
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
    const VALID_GOODS: Record<string, string> = {
        fuel: 'fuel',
        organics: 'organics',
        equipment: 'equipment',
    };
    const col = VALID_GOODS[good];
    if (!col) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Invalid good' });
        return;
    }

    if (!['buy', 'sell'].includes(action)) {
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

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const currentSector = await getCurrentSector(playerId, client);
        if (currentSector === undefined) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }

        const portRes = await client.query(
            `SELECT p.id as port_id, p.class, p.fuel, p.fuel_price, p.organics, p.org_price, p.equipment, p.equ_price
             FROM ports p JOIN sectors s ON p.sector_id = s.id
             WHERE s.sector_number = $1 AND s.universe_id = $2 FOR UPDATE OF p`,
            [currentSector, universeId],
        );
        if (portRes.rows.length === 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, {
                type: ServerMsgType.Error,
                message: 'No port in this sector',
            });
            return;
        }

        const port = portRes.rows[0];

        const priceColMap: Record<string, string> = {
            fuel: 'fuel_price',
            organics: 'org_price',
            equipment: 'equ_price',
        };
        const portActions = PORT_CLASS_ACTIONS[port.class];
        if (
            !portActions ||
            (action === 'buy' && portActions[good] !== 'S') ||
            (action === 'sell' && portActions[good] !== 'B')
        ) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, {
                type: ServerMsgType.Error,
                message: 'Port does not trade this commodity',
            });
            return;
        }

        const price: number = port[priceColMap[good]];

        const cargoRes = await client.query(
            `
            SELECT s.fuel, s.organics, s.equipment, s.colonists, p.credits, s.holds as cargo_limit
            FROM players p
            JOIN ships s ON p.ship_id = s.id
            WHERE p.id = $1 FOR UPDATE OF s, p
        `,
            [playerId],
        );
        if (cargoRes.rows.length === 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }

        const cargo = cargoRes.rows[0];

        if (action === 'buy') {
            // Check turns for buying
            const turnResult = await checkAndDeductTurns(playerId, universeId, 1, client);
            if (!turnResult.allowed) {
                await client.query('ROLLBACK');
                sendEnvelope(playerId, {
                    type: ServerMsgType.Error,
                    message: 'Insufficient turns',
                });
                return;
            }

            const cost = qty * price;
            if (cargo.credits < cost) {
                await client.query('ROLLBACK');
                sendEnvelope(playerId, {
                    type: ServerMsgType.Error,
                    message: 'Insufficient credits',
                });
                return;
            }
            if (port[good] < qty) {
                await client.query('ROLLBACK');
                sendEnvelope(playerId, {
                    type: ServerMsgType.Error,
                    message: 'Insufficient port inventory',
                });
                return;
            }
            if (
                cargo.fuel + cargo.organics + cargo.equipment + cargo.colonists + qty >
                cargo.cargo_limit
            ) {
                await client.query('ROLLBACK');
                sendEnvelope(playerId, {
                    type: ServerMsgType.Error,
                    message: 'Insufficient cargo holds',
                });
                return;
            }

            await client.query(`UPDATE ports SET ${col} = ${col} - $1 WHERE id = $2`, [
                qty,
                port.port_id,
            ]);
            await client.query(
                `UPDATE ships SET ${col} = ${col} + $1 WHERE id = (SELECT ship_id FROM players WHERE id = $2)`,
                [qty, playerId],
            );
            await client.query(`UPDATE players SET credits = credits - $1 WHERE id = $2`, [
                cost,
                playerId,
            ]);
            await client.query('COMMIT');

            cargo[good] += qty;
            cargo.credits -= cost;
            const usedAfterBuy = cargo.fuel + cargo.organics + cargo.equipment + cargo.colonists;
            sendEnvelope(playerId, {
                type: ServerMsgType.PortTransactionResult,
                credits: cargo.credits,
                cargo: {
                    fuel: cargo.fuel,
                    organics: cargo.organics,
                    equipment: cargo.equipment,
                    colonists: cargo.colonists,
                },
                emptyHolds: Math.max(0, cargo.cargo_limit - usedAfterBuy),
                turnsUsed: turnResult.turnsUsed,
            });
        } else {
            const revenue = qty * price;
            if (cargo[good] < qty) {
                await client.query('ROLLBACK');
                sendEnvelope(playerId, {
                    type: ServerMsgType.Error,
                    message: 'Insufficient cargo',
                });
                return;
            }
            if (port[good] < qty) {
                await client.query('ROLLBACK');
                sendEnvelope(playerId, {
                    type: ServerMsgType.Error,
                    message: 'Port cannot buy that many',
                });
                return;
            }

            await client.query(`UPDATE ports SET ${col} = ${col} - $1 WHERE id = $2`, [
                qty,
                port.port_id,
            ]);
            await client.query(
                `UPDATE ships SET ${col} = ${col} - $1 WHERE id = (SELECT ship_id FROM players WHERE id = $2)`,
                [qty, playerId],
            );
            await client.query(`UPDATE players SET credits = credits + $1 WHERE id = $2`, [
                revenue,
                playerId,
            ]);
            await client.query('COMMIT');

            cargo[good] -= qty;
            cargo.credits += revenue;
            const usedAfterSell = cargo.fuel + cargo.organics + cargo.equipment + cargo.colonists;
            sendEnvelope(playerId, {
                type: ServerMsgType.PortTransactionResult,
                credits: cargo.credits,
                cargo: {
                    fuel: cargo.fuel,
                    organics: cargo.organics,
                    equipment: cargo.equipment,
                    colonists: cargo.colonists,
                },
                emptyHolds: Math.max(0, cargo.cargo_limit - usedAfterSell),
            });
        }
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Trade error', err);
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
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

    const portRes = await pool.query(
        `SELECT p.class FROM ports p JOIN sectors s ON p.sector_id = s.id
         WHERE s.sector_number = $1 AND s.universe_id = $2`,
        [player.sector, player.universeId],
    );
    if (portRes.rows.length === 0 || portRes.rows[0].class !== 9) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'Starbase not found in this sector',
        });
        return;
    }

    player.at_starbase = true;
    await setPlayerMenu(playerId, 'starbase');

    // Fetch hardware prices from the universe's edit (or fall back to defaults)
    const priceRes = await pool.query<HardwarePriceRow>(
        `SELECT hi.name, hi.label, COALESCE(hp.price, hi.default_price) as price
         FROM hardware_item hi
         LEFT JOIN hardware_price hp ON hp.hardware_item_id = hi.id
           AND hp.edit_id = (SELECT edit_id FROM universes WHERE id = $1)
         ORDER BY hi.id`,
        [player.universeId],
    );
    sendEnvelope(playerId, {
        type: ServerMsgType.DockStarbaseResult,
        prices: priceRes.rows.map((r) => ({ name: r.name, label: r.label, price: r.price })),
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

import { ServerTag, holdBaseCostNow, holdCostRange } from '@twnr/shared';
import type { BuyDronesCommand, BuyShieldsCommand, BuyHoldsCommand } from '@twnr/shared';
import { onlinePlayers, getPlayerUniverseId } from '../state/players.js';
import { sendEnvelope, sendError } from '../state/messaging.js';
import { AbortTransaction } from '../db/index.js';
import { runMutation } from './run-mutation.js';
import { getCurrentSector, deductCredits } from '../db/queries/player.js';
import {
    getShipUpgradeInfoForUpdate,
    incrementShipDrones,
    incrementShipShields,
    incrementShipHolds,
} from '../db/queries/ship.js';
import { getPortClassAtSector } from '../db/queries/port.js';
import { class0Prices } from '../game-config.js';
import { checkAndDeductTurns } from '../turn-logic.js';
import { notifyTurnChange } from '../services/notify.js';
import { recordCreditChange } from '../services/audit.js';

async function isAtClass0OrStarbase(
    playerId: number,
    universeId: number,
    client: Parameters<typeof getCurrentSector>[1],
): Promise<boolean> {
    if (onlinePlayers[playerId]?.at_starbase) return true;
    const currentSector = await getCurrentSector(playerId, client);
    if (currentSector === undefined) return false;
    const portClass = await getPortClassAtSector(currentSector, universeId, client);
    return portClass === 0;
}

export async function serveBuyDrones(playerId: number, data: BuyDronesCommand): Promise<void> {
    const qty = Number(data.quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
        sendError(playerId, 'Invalid quantity');
        return;
    }

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    await runMutation(
        playerId,
        'Buy drones',
        async (client) => {
            if (!(await isAtClass0OrStarbase(playerId, universeId, client))) {
                sendError(playerId, 'Not at a class 0 port or starbase');
                throw new AbortTransaction();
            }

            const data = await getShipUpgradeInfoForUpdate(playerId, client);
            if (!data) {
                sendError(playerId, 'Player not found');
                throw new AbortTransaction();
            }

            if (data.drones + qty > data.max_drones) {
                sendError(playerId, 'Exceeds maximum');
                throw new AbortTransaction();
            }

            const cost = qty * class0Prices.dronePrice;
            if (data.credits < cost) {
                sendError(playerId, 'Insufficient credits');
                throw new AbortTransaction();
            }

            await incrementShipDrones(playerId, qty, client);
            await deductCredits(playerId, cost, client);
            await recordCreditChange(client, {
                playerId,
                actionType: 'buy_drones',
                delta: -cost,
                prevCredits: data.credits,
                newCredits: data.credits - cost,
                context: { qty, unitPrice: class0Prices.dronePrice },
            });
            return { credits: data.credits - cost, drones: data.drones + qty };
        },
        (result) =>
            sendEnvelope(playerId, {
                type: ServerTag.BuyDronesResult,
                credits: result.credits,
                drones: result.drones,
            }),
    );
}

export async function serveBuyShields(playerId: number, data: BuyShieldsCommand): Promise<void> {
    const { quantity } = data;
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
        sendError(playerId, 'Invalid quantity');
        return;
    }

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    await runMutation(
        playerId,
        'Buy shields',
        async (client) => {
            if (!(await isAtClass0OrStarbase(playerId, universeId, client))) {
                sendError(playerId, 'Not at a class 0 port or starbase');
                throw new AbortTransaction();
            }

            const data = await getShipUpgradeInfoForUpdate(playerId, client);
            if (!data) {
                sendError(playerId, 'Player not found');
                throw new AbortTransaction();
            }

            if (data.shields + qty > data.max_shields) {
                sendError(playerId, 'Exceeds maximum');
                throw new AbortTransaction();
            }

            const cost = qty * class0Prices.shieldPrice;
            if (data.credits < cost) {
                sendError(playerId, 'Insufficient credits');
                throw new AbortTransaction();
            }

            await incrementShipShields(playerId, qty, client);
            await deductCredits(playerId, cost, client);
            await recordCreditChange(client, {
                playerId,
                actionType: 'buy_shields',
                delta: -cost,
                prevCredits: data.credits,
                newCredits: data.credits - cost,
                context: { qty, unitPrice: class0Prices.shieldPrice },
            });
            return { credits: data.credits - cost, shields: data.shields + qty };
        },
        (result) =>
            sendEnvelope(playerId, {
                type: ServerTag.BuyShieldsResult,
                credits: result.credits,
                shields: result.shields,
            }),
    );
}

export async function serveBuyHolds(playerId: number, data: BuyHoldsCommand): Promise<void> {
    const { quantity } = data;
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
        sendError(playerId, 'Invalid quantity');
        return;
    }

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    await runMutation(
        playerId,
        'Buy holds',
        async (client) => {
            if (!(await isAtClass0OrStarbase(playerId, universeId, client))) {
                sendError(playerId, 'Not at a class 0 port or starbase');
                throw new AbortTransaction();
            }

            const turnResult = await checkAndDeductTurns(playerId, universeId, 1, client);
            if (!turnResult.allowed) {
                sendError(playerId, 'Insufficient turns');
                throw new AbortTransaction();
            }

            const data = await getShipUpgradeInfoForUpdate(playerId, client);
            if (!data) {
                sendError(playerId, 'Player not found');
                throw new AbortTransaction();
            }

            if (data.holds + qty > data.max_holds) {
                sendError(playerId, 'Exceeds maximum');
                throw new AbortTransaction();
            }

            // each successive hold costs B + I more than the last.
            const baseCost = holdBaseCostNow(
                class0Prices.holdBaseCostMin,
                class0Prices.holdBaseCostMax,
                class0Prices.holdCostPeriodDays,
            );
            const cost = holdCostRange(data.holds, data.holds + qty, baseCost);
            if (data.credits < cost) {
                sendError(playerId, 'Insufficient credits');
                throw new AbortTransaction();
            }

            await incrementShipHolds(playerId, qty, client);
            await deductCredits(playerId, cost, client);
            await recordCreditChange(client, {
                playerId,
                actionType: 'buy_holds',
                delta: -cost,
                prevCredits: data.credits,
                newCredits: data.credits - cost,
                context: {
                    qty,
                    fromHolds: data.holds,
                    toHolds: data.holds + qty,
                    baseCost,
                    totalCost: cost,
                },
            });
            return {
                credits: data.credits - cost,
                cargoLimit: data.holds + qty,
                turnsUsed: turnResult.turnsUsed,
            };
        },
        (result) => {
            if (result.turnsUsed) {
                notifyTurnChange(playerId, result.turnsUsed, 'buying cargo holds');
            }
            sendEnvelope(playerId, {
                type: ServerTag.BuyHoldsResult,
                credits: result.credits,
                cargoLimit: result.cargoLimit,
                turnsUsed: result.turnsUsed,
            });
        },
    );
}

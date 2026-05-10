import { ServerMsgType } from '@twnr/shared';
import { players, getPlayerUniverseId } from '../state/players.js';
import { sendEnvelope, sendError } from '../state/messaging.js';
import { withTransaction, AbortTransaction } from '../db/index.js';
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
import { recordCreditChange } from '../services/audit.js';


async function isAtClass0OrStarbase(
    playerId: number,
    universeId: number,
    client: Parameters<typeof getCurrentSector>[1],
): Promise<boolean> {
    if (players[playerId]?.at_starbase) return true;
    const currentSector = await getCurrentSector(playerId, client);
    if (currentSector === undefined) return false;
    const portClass = await getPortClassAtSector(currentSector, universeId, client);
    return portClass === 0;
}

export async function handleBuyDrones(playerId: number, quantity: number): Promise<void> {
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
        sendError(playerId, 'Invalid quantity');
        return;
    }

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    try {
        const result = await withTransaction(async (client) => {
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
        });

        if (!result) return;

        await sendEnvelope(
            playerId,
            {
                type: ServerMsgType.BuyDronesResult,
                credits: result.credits,
                drones: result.drones,
            }
        );
    } catch {
        sendError(playerId, 'Internal server error');
    }
}

export async function handleBuyShields(playerId: number, quantity: number): Promise<void> {
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
        sendError(playerId, 'Invalid quantity');
        return;
    }

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    try {
        const result = await withTransaction(async (client) => {
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
        });

        if (!result) return;

        await sendEnvelope(
            playerId,
            {
                type: ServerMsgType.BuyShieldsResult,
                credits: result.credits,
                shields: result.shields,
            }
        );
    } catch {
        sendError(playerId, 'Internal server error');
    }
}

export async function handleBuyHolds(playerId: number, quantity: number): Promise<void> {
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
        sendError(playerId, 'Invalid quantity');
        return;
    }

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    try {
        const result = await withTransaction(async (client) => {
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

            const cost = qty * class0Prices.holdPrice;
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
                context: { qty, unitPrice: class0Prices.holdPrice },
            });
            return {
                credits: data.credits - cost,
                cargoLimit: data.holds + qty,
                turnsUsed: turnResult.turnsUsed,
            };
        });

        if (!result) return;

        await sendEnvelope(
            playerId,
            {
                type: ServerMsgType.BuyHoldsResult,
                credits: result.credits,
                cargoLimit: result.cargoLimit,
                turnsUsed: result.turnsUsed,
            }
        );
    } catch {
        sendError(playerId, 'Internal server error');
    }
}

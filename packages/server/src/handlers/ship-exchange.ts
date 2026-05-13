import { ServerTag } from '@twnr/shared';
import type { BuyShipTradeinCommand, BuyShipNewCommand } from '@twnr/shared';
import { players, getPlayerUniverseId } from '../state/players.js';
import { sendEnvelope, sendError } from '../state/messaging.js';
import { withTransaction, AbortTransaction } from '../db/index.js';
import {
    getShipTypeByName,
    getPlayerShipTradeInfoForUpdate,
    getPlayerShipBuyInfoForUpdate,
    insertEmptyShip,
    setPlayerShipAndDeductCredits,
    deleteShipById,
    type ShipTypeRow,
} from '../db/queries/ship.js';
import { recordCreditChange } from '../services/audit.js';
import { setPendingShipPurchase } from '../state/pending-ship-purchases.js';

function calculateShipPrice(shipType: {
    cost_drive: number;
    cost_computer: number;
    cost_hull: number;
    hold_cost: number;
    starting_holds: number;
}): number {
    return (
        shipType.cost_drive +
        shipType.cost_computer +
        shipType.cost_hull +
        shipType.starting_holds * shipType.hold_cost
    );
}

/** Pre-buy entry: validate, store pending purchase, prompt for ship name. */
export async function serveBuyShipNew(playerId: number, data: BuyShipNewCommand): Promise<void> {
    if (!players[playerId]?.at_starbase) {
        sendError(playerId, 'Not at Starbase');
        return;
    }
    const targetType = await getShipTypeByName(data.targetShipName);
    if (!targetType) {
        sendError(playerId, 'Unknown ship');
        return;
    }
    setPendingShipPurchase(playerId, { kind: 'new', targetShipName: data.targetShipName });
    sendEnvelope(playerId, {
        type: ServerTag.ShipNameRequired,
        reason: 'buyNew',
        shipTypeName: targetType.name,
        shipTypeDisplayName: targetType.display_name ?? targetType.name,
    });
}

/** Pre-tradein entry: validate, store pending purchase, prompt for ship name. */
export async function serveBuyShipTradein(
    playerId: number,
    data: BuyShipTradeinCommand,
): Promise<void> {
    if (!players[playerId]?.at_starbase) {
        sendError(playerId, 'Not at Starbase');
        return;
    }
    const targetType = await getShipTypeByName(data.targetShipName);
    if (!targetType) {
        sendError(playerId, 'Unknown ship');
        return;
    }
    setPendingShipPurchase(playerId, { kind: 'tradein', targetShipName: data.targetShipName });
    sendEnvelope(playerId, {
        type: ServerTag.ShipNameRequired,
        reason: 'tradein',
        shipTypeName: targetType.name,
        shipTypeDisplayName: targetType.display_name ?? targetType.name,
    });
}

/** Commit a deferred Buy-new purchase using the supplied ship name. */
export async function executeBuyShipNew(
    playerId: number,
    targetShipName: string,
    shipName: string,
): Promise<void> {
    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    try {
        const result = await withTransaction(async (client) => {
            const targetType = await getShipTypeByName(targetShipName, client);
            if (!targetType) {
                sendError(playerId, 'Unknown ship');
                throw new AbortTransaction();
            }
            const price = calculateShipPrice(targetType);

            const data = await getPlayerShipBuyInfoForUpdate(playerId, client);
            if (!data) {
                sendError(playerId, 'Player not found');
                throw new AbortTransaction();
            }

            if (data.ship_name === targetShipName) {
                sendError(playerId, 'Already on that ship');
                throw new AbortTransaction();
            }

            if (data.credits < price) {
                sendError(playerId, 'Insufficient credits');
                throw new AbortTransaction();
            }

            const newCargoLimit = targetType.starting_holds;
            const newShipId = await insertEmptyShip(
                playerId,
                universeId,
                targetType.id,
                data.current_sector_id,
                newCargoLimit,
                targetType.turns_per_warp,
                shipName,
                client,
            );
            await setPlayerShipAndDeductCredits(playerId, newShipId, price, client);
            await recordCreditChange(client, {
                playerId,
                actionType: 'ship_exchange',
                delta: -price,
                prevCredits: data.credits,
                newCredits: data.credits - price,
                context: {
                    mode: 'new',
                    toShip: targetShipName,
                    price,
                },
            });

            return {
                credits: data.credits - price,
                maxDrones: targetType.max_drones,
                maxShields: targetType.max_shields,
                cargoLimit: newCargoLimit,
                coloredName: targetType.display_name,
            };
        });

        if (!result) return;

        await sendEnvelope(playerId, {
            type: ServerTag.BuyShipNewResult,
            shipName: targetShipName,
            coloredShipName: result.coloredName,
            credits: result.credits,
            maxDrones: result.maxDrones,
            maxShields: result.maxShields,
            cargoLimit: result.cargoLimit,
        });
    } catch (err) {
        console.error('ship-exchange new error:', err);
        sendError(playerId, 'Internal server error');
    }
}

/** Commit a deferred Trade-in purchase using the supplied ship name. */
export async function executeBuyShipTradein(
    playerId: number,
    targetShipName: string,
    shipName: string,
): Promise<void> {
    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    try {
        const result = await withTransaction(async (client) => {
            const targetType: ShipTypeRow | undefined = await getShipTypeByName(
                targetShipName,
                client,
            );
            if (!targetType) {
                sendError(playerId, 'Unknown ship');
                throw new AbortTransaction();
            }

            const data = await getPlayerShipTradeInfoForUpdate(playerId, client);
            if (!data) {
                sendError(playerId, 'Player not found');
                throw new AbortTransaction();
            }

            if (data.ship_name === targetShipName) {
                sendError(playerId, 'Already on that ship');
                throw new AbortTransaction();
            }

            const targetPrice = calculateShipPrice(targetType);
            const currentPrice = calculateShipPrice({
                cost_drive: data.current_cost_drive,
                cost_computer: data.current_cost_computer,
                cost_hull: data.current_cost_hull,
                hold_cost: data.current_hold_cost,
                starting_holds: data.current_starting_holds,
            });
            const cost = targetPrice - currentPrice;
            if (cost > 0 && data.credits < cost) {
                sendError(playerId, 'Insufficient credits');
                throw new AbortTransaction();
            }

            const newCargoLimit = targetType.starting_holds;
            const newShipId = await insertEmptyShip(
                playerId,
                universeId,
                targetType.id,
                data.current_sector_id,
                newCargoLimit,
                targetType.turns_per_warp,
                shipName,
                client,
            );
            await setPlayerShipAndDeductCredits(playerId, newShipId, cost, client);
            await deleteShipById(data.ship_id, client);
            await recordCreditChange(client, {
                playerId,
                actionType: 'ship_exchange',
                delta: -cost,
                prevCredits: data.credits,
                newCredits: data.credits - cost,
                context: {
                    mode: 'tradein',
                    fromShip: data.ship_name,
                    toShip: targetShipName,
                    targetPrice,
                    currentPrice,
                },
            });

            return {
                credits: data.credits - cost,
                maxDrones: targetType.max_drones,
                maxShields: targetType.max_shields,
                cargoLimit: newCargoLimit,
                coloredName: targetType.display_name,
            };
        });

        if (!result) return;

        await sendEnvelope(playerId, {
            type: ServerTag.BuyShipTradeinResult,
            shipName: targetShipName,
            coloredShipName: result.coloredName,
            credits: result.credits,
            maxDrones: result.maxDrones,
            maxShields: result.maxShields,
            cargoLimit: result.cargoLimit,
        });
    } catch (err) {
        console.error('ship-exchange tradein error:', err);
        sendError(playerId, 'Internal server error');
    }
}

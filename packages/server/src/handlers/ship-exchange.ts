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

export async function serveBuyShipTradein(
    playerId: number,
    data: BuyShipTradeinCommand,
): Promise<void> {
    const { targetShipName } = data;
    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    const player = players[playerId];
    if (!player?.at_starbase) {
        sendError(playerId, 'Not at Starbase');
        return;
    }

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
        console.error('ship-exchange error:', err);
        sendError(playerId, 'Internal server error');
    }
}

export async function serveBuyShipNew(playerId: number, data: BuyShipNewCommand): Promise<void> {
    const { targetShipName } = data;
    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    const player = players[playerId];
    if (!player?.at_starbase) {
        sendError(playerId, 'Not at Starbase');
        return;
    }

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
        console.error('ship-exchange error:', err);
        sendError(playerId, 'Internal server error');
    }
}

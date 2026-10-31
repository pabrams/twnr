import { ServerTag } from '@twnr/shared';
import type { CommandRequest } from '@twnr/shared';
import { onlinePlayers, getPlayerUniverseId } from '../state/players.js';
import { sendEnvelope, sendError } from '../state/messaging.js';

import {
    getShipTypeBySlug,
    getPlayerShipTradeInfoForUpdate,
    getPlayerShipBuyInfoForUpdate,
    insertEmptyShip,
    setPlayerShipAndDeductCredits,
    deleteShipById,
    type ShipTypeRow,
} from '../db/queries/ship.js';
import { setPendingShipPurchase } from '../state/pending-ship-purchases.js';
import { type CommandResult, commandError, abort, isCommandError, runMutation } from './command.js';

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

export async function serveBuyShipNew(
    playerId: number,
    data: CommandRequest<'BuyShipNew'>,
): Promise<CommandResult<'BuyShipNew'>> {
    if (!onlinePlayers[playerId]?.at_starbase) {
        return commandError('Not at Starbase');
    }
    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;
    const targetType = await getShipTypeBySlug(universeId, data.targetShipName);
    if (!targetType) {
        return commandError('Unknown ship');
    }
    setPendingShipPurchase(playerId, { kind: 'new', targetShipName: data.targetShipName });
    sendEnvelope(playerId, {
        type: ServerTag.ShipNameRequired,
        reason: 'buyNew',
        shipTypeName: targetType.slug,
        shipTypeDisplayName: targetType.display_name ?? targetType.slug,
    });
}

export async function serveBuyShipTradein(
    playerId: number,
    data: CommandRequest<'BuyShipTradein'>,
): Promise<CommandResult<'BuyShipTradein'>> {
    if (!onlinePlayers[playerId]?.at_starbase) {
        return commandError('Not at Starbase');
    }
    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;
    const targetType = await getShipTypeBySlug(universeId, data.targetShipName);
    if (!targetType) {
        return commandError('Unknown ship');
    }
    setPendingShipPurchase(playerId, { kind: 'tradein', targetShipName: data.targetShipName });
    sendEnvelope(playerId, {
        type: ServerTag.ShipNameRequired,
        reason: 'tradein',
        shipTypeName: targetType.slug,
        shipTypeDisplayName: targetType.display_name ?? targetType.slug,
    });
}

export async function executeBuyShipNew(
    playerId: number,
    targetShipName: string,
    shipName: string,
): Promise<void> {
    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    const result = await runMutation(
        'Ship exchange new',
        async (client) => {
            const targetType = await getShipTypeBySlug(universeId, targetShipName, client);
            if (!targetType) {
                throw abort(commandError('Unknown ship'));
            }
            const price = calculateShipPrice(targetType);

            const data = await getPlayerShipBuyInfoForUpdate(playerId, client);
            if (!data) {
                throw abort(commandError('Player not found'));
            }

            if (data.ship_type_slug === targetShipName) {
                throw abort(commandError('Already on that ship'));
            }

            if (data.credits < price) {
                throw abort(commandError('Insufficient credits'));
            }

            const newCargoLimit = targetType.starting_holds;
            const newShipId = await insertEmptyShip(
                playerId,
                universeId,
                targetType.slug,
                data.current_sector_id,
                newCargoLimit,
                targetType.turns_per_warp,
                shipName,
                client,
            );
            await setPlayerShipAndDeductCredits(playerId, newShipId, price, client);

            return {
                newShipId,
                credits: data.credits - price,
                maxDrones: targetType.max_drones,
                maxShields: targetType.max_shields,
                cargoLimit: newCargoLimit,
                coloredName: targetType.display_name,
            };
        },
        (result) => {
            const player = onlinePlayers[playerId];
            if (player) {
                player.shipId = result.newShipId;
                player.shipName = shipName;
            }
            return {
                shipTypeName: targetShipName,
                coloredShipName: result.coloredName,
                credits: result.credits,
                maxDrones: result.maxDrones,
                maxShields: result.maxShields,
                cargoLimit: result.cargoLimit,
            };
        },
    );
    if (isCommandError(result)) {
        sendError(playerId, result.message);
        return;
    }
    sendEnvelope(playerId, { type: ServerTag.BuyShipNewResult, ...result });
}

export async function executeBuyShipTradein(
    playerId: number,
    targetShipName: string,
    shipName: string,
): Promise<void> {
    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    const result = await runMutation(
        'Ship exchange tradein',
        async (client) => {
            const targetType: ShipTypeRow | undefined = await getShipTypeBySlug(
                universeId,
                targetShipName,
                client,
            );
            if (!targetType) {
                throw abort(commandError('Unknown ship'));
            }

            const data = await getPlayerShipTradeInfoForUpdate(playerId, client);
            if (!data) {
                throw abort(commandError('Player not found'));
            }

            if (data.ship_type_slug === targetShipName) {
                throw abort(commandError('Already on that ship'));
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
                throw abort(commandError('Insufficient credits'));
            }

            const newCargoLimit = targetType.starting_holds;
            const newShipId = await insertEmptyShip(
                playerId,
                universeId,
                targetType.slug,
                data.current_sector_id,
                newCargoLimit,
                targetType.turns_per_warp,
                shipName,
                client,
            );
            await setPlayerShipAndDeductCredits(playerId, newShipId, cost, client);
            await deleteShipById(data.ship_id, client);

            return {
                newShipId,
                credits: data.credits - cost,
                maxDrones: targetType.max_drones,
                maxShields: targetType.max_shields,
                cargoLimit: newCargoLimit,
                coloredName: targetType.display_name,
            };
        },
        (result) => {
            const player = onlinePlayers[playerId];
            if (player) {
                player.shipId = result.newShipId;
                player.shipName = shipName;
            }
            return {
                shipTypeName: targetShipName,
                coloredShipName: result.coloredName,
                credits: result.credits,
                maxDrones: result.maxDrones,
                maxShields: result.maxShields,
                cargoLimit: result.cargoLimit,
            };
        },
    );
    if (isCommandError(result)) {
        sendError(playerId, result.message);
        return;
    }
    sendEnvelope(playerId, { type: ServerTag.BuyShipTradeinResult, ...result });
}

import type { CommandRequest } from '@twnr/shared';
import { onlinePlayers, requireOnlinePlayer } from '../state/players.js';

import {
    getShipTypeBySlug,
    getPlayerShipTradeInfoForUpdate,
    getPlayerShipBuyInfoForUpdate,
    insertEmptyShip,
    setPlayerShipAndDeductCredits,
    deleteShipById,
    type ShipTypeRow,
} from '../db/queries/ship.js';
import { type CommandResult, type ReplyBody, commandRefusal, mutateAndReply } from './command.js';

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
    if (!onlinePlayers[playerId]?.at_starbase) return commandRefusal('notAtStarbase');
    const { universeId } = requireOnlinePlayer(playerId);
    return buyShipNew(playerId, universeId, data.targetShipName, data.name);
}

export async function serveBuyShipTradein(
    playerId: number,
    data: CommandRequest<'BuyShipTradein'>,
): Promise<CommandResult<'BuyShipTradein'>> {
    if (!onlinePlayers[playerId]?.at_starbase) return commandRefusal('notAtStarbase');
    const { universeId } = requireOnlinePlayer(playerId);
    return buyShipTradein(playerId, universeId, data.targetShipName, data.name);
}

async function buyShipNew(
    playerId: number,
    universeId: number,
    targetShipName: string,
    shipName: string,
): Promise<ReplyBody<'BuyShipNew'>> {
    return mutateAndReply(
        async (client, abort) => {
            const targetType = await getShipTypeBySlug(universeId, targetShipName, client);
            if (!targetType) {
                throw abort(commandRefusal('unknownShipType'));
            }
            const price = calculateShipPrice(targetType);

            const data = await getPlayerShipBuyInfoForUpdate(playerId, client);
            if (!data) {
                throw new Error('Player not found');
            }

            if (data.ship_type_slug === targetShipName) {
                throw abort(commandRefusal('alreadyOnShip'));
            }

            if (data.credits < price) {
                throw abort(commandRefusal('insufficientCredits'));
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
                outcome: 'ok',
                shipTypeName: targetShipName,
                coloredShipName: result.coloredName,
                credits: result.credits,
                maxDrones: result.maxDrones,
                maxShields: result.maxShields,
                cargoLimit: result.cargoLimit,
            };
        },
    );
}

async function buyShipTradein(
    playerId: number,
    universeId: number,
    targetShipName: string,
    shipName: string,
): Promise<ReplyBody<'BuyShipTradein'>> {
    return mutateAndReply(
        async (client, abort) => {
            const targetType: ShipTypeRow | undefined = await getShipTypeBySlug(
                universeId,
                targetShipName,
                client,
            );
            if (!targetType) {
                throw abort(commandRefusal('unknownShipType'));
            }

            const data = await getPlayerShipTradeInfoForUpdate(playerId, client);
            if (!data) {
                throw new Error('Player not found');
            }

            if (data.ship_type_slug === targetShipName) {
                throw abort(commandRefusal('alreadyOnShip'));
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
                throw abort(commandRefusal('insufficientCredits'));
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
                outcome: 'ok',
                shipTypeName: targetShipName,
                coloredShipName: result.coloredName,
                credits: result.credits,
                maxDrones: result.maxDrones,
                maxShields: result.maxShields,
                cargoLimit: result.cargoLimit,
            };
        },
    );
}

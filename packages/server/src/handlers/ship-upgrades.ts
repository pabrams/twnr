import { holdCostRange } from '@twnr/shared';
import type { CommandRequest } from '@twnr/shared';
import { onlinePlayers, getPlayerUniverseId } from '../state/players.js';

import { getCurrentSector, deductCredits } from '../db/queries/player.js';
import {
    getShipUpgradeInfoForUpdate,
    incrementShipDrones,
    incrementShipShields,
    incrementShipHolds,
} from '../db/queries/ship.js';
import { getPortClassAtSector } from '../db/queries/port.js';
import { class0Prices } from '../game-config.js';
import { currentClass0Prices } from '../services/class0-prices.js';
import { checkAndDeductTurns } from '../turn-logic.js';
import { notifyTurnChange } from '../services/notify.js';
import { type CommandResult, commandError, abort, runMutation } from './command.js';

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

export async function serveBuyDrones(
    playerId: number,
    data: CommandRequest<'BuyDrones'>,
): Promise<CommandResult<'BuyDrones'>> {
    const qty = Number(data.quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
        return commandError('Invalid quantity');
    }

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    return runMutation(
        'Buy drones',
        async (client) => {
            if (!(await isAtClass0OrStarbase(playerId, universeId, client))) {
                throw abort(commandError('Not at a class 0 port or starbase'));
            }

            const data = await getShipUpgradeInfoForUpdate(playerId, client);
            if (!data) {
                throw abort(commandError('Player not found'));
            }

            if (data.drones + qty > data.max_drones) {
                throw abort(commandError('Exceeds maximum'));
            }

            const cost = qty * class0Prices.dronePrice;
            if (data.credits < cost) {
                throw abort(commandError('Insufficient credits'));
            }

            await incrementShipDrones(playerId, qty, client);
            await deductCredits(playerId, cost, client);
            return { credits: data.credits - cost, drones: data.drones + qty };
        },
        (result) => ({
            credits: result.credits,
            drones: result.drones,
        }),
    );
}

export async function serveBuyShields(
    playerId: number,
    data: CommandRequest<'BuyShields'>,
): Promise<CommandResult<'BuyShields'>> {
    const { quantity } = data;
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
        return commandError('Invalid quantity');
    }

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    return runMutation(
        'Buy shields',
        async (client) => {
            if (!(await isAtClass0OrStarbase(playerId, universeId, client))) {
                throw abort(commandError('Not at a class 0 port or starbase'));
            }

            const data = await getShipUpgradeInfoForUpdate(playerId, client);
            if (!data) {
                throw abort(commandError('Player not found'));
            }

            if (data.shields + qty > data.max_shields) {
                throw abort(commandError('Exceeds maximum'));
            }

            const cost = qty * class0Prices.shieldPrice;
            if (data.credits < cost) {
                throw abort(commandError('Insufficient credits'));
            }

            await incrementShipShields(playerId, qty, client);
            await deductCredits(playerId, cost, client);
            return { credits: data.credits - cost, shields: data.shields + qty };
        },
        (result) => ({
            credits: result.credits,
            shields: result.shields,
        }),
    );
}

export async function serveBuyHolds(
    playerId: number,
    data: CommandRequest<'BuyHolds'>,
): Promise<CommandResult<'BuyHolds'>> {
    const { quantity } = data;
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
        return commandError('Invalid quantity');
    }

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    return runMutation(
        'Buy holds',
        async (client) => {
            if (!(await isAtClass0OrStarbase(playerId, universeId, client))) {
                throw abort(commandError('Not at a class 0 port or starbase'));
            }

            const turnResult = await checkAndDeductTurns(playerId, universeId, 1, client);
            if (!turnResult.allowed) {
                throw abort(commandError('Insufficient turns'));
            }

            const data = await getShipUpgradeInfoForUpdate(playerId, client);
            if (!data) {
                throw abort(commandError('Player not found'));
            }

            if (data.holds + qty > data.max_holds) {
                throw abort(commandError('Exceeds maximum'));
            }

            const { holdBaseCost: baseCost } = currentClass0Prices();
            const cost = holdCostRange(data.holds, data.holds + qty, baseCost);
            if (data.credits < cost) {
                throw abort(commandError('Insufficient credits'));
            }

            await incrementShipHolds(playerId, qty, client);
            await deductCredits(playerId, cost, client);
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
            return {
                credits: result.credits,
                cargoLimit: result.cargoLimit,
                turnsUsed: result.turnsUsed,
            };
        },
    );
}

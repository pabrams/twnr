import type { CommandRequest } from '@twnr/shared';
import {
    getPendingShipPurchase,
    clearPendingShipPurchase,
} from '../state/pending-ship-purchases.js';
import { executeBuyShipNew, executeBuyShipTradein } from './ship-exchange.js';
import { type CommandResult, commandRefusal } from './command.js';

export async function serveSetShipName(
    playerId: number,
    data: CommandRequest<'SetShipName'>,
): Promise<CommandResult<'SetShipName'>> {
    const pending = getPendingShipPurchase(playerId);
    if (!pending) {
        return commandRefusal('noPurchasePending');
    }
    clearPendingShipPurchase(playerId);
    if (pending.kind === 'new') {
        await executeBuyShipNew(playerId, pending.targetShipName, data.name);
    } else {
        await executeBuyShipTradein(playerId, pending.targetShipName, data.name);
    }
    return { outcome: 'ok' };
}

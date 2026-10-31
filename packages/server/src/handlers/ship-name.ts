import type { CommandRequest } from '@twnr/shared';
import {
    getPendingShipPurchase,
    clearPendingShipPurchase,
} from '../state/pending-ship-purchases.js';
import { executeBuyShipNew, executeBuyShipTradein } from './ship-exchange.js';
import { MAX_SHIP_NAME_LENGTH } from '../services/starting-ship.js';
import { type CommandResult, commandError } from './command.js';

function validateName(raw: string): { ok: true; name: string } | { ok: false; message: string } {
    const name = raw.trim();
    if (name.length === 0) return { ok: false, message: 'Ship name cannot be blank.' };
    if (name.length > MAX_SHIP_NAME_LENGTH) {
        return { ok: false, message: `Ship name too long (max ${MAX_SHIP_NAME_LENGTH}).` };
    }
    return { ok: true, name };
}

export async function serveSetShipName(
    playerId: number,
    data: CommandRequest<'SetShipName'>,
): Promise<CommandResult<'SetShipName'>> {
    const v = validateName(data.name);
    if (!v.ok) {
        return {
            outcome: 'invalid',
            message: v.message,
        };
    }

    const pending = getPendingShipPurchase(playerId);
    if (!pending) {
        return commandError('No ship purchase awaiting a name.');
    }
    clearPendingShipPurchase(playerId);
    if (pending.kind === 'new') {
        await executeBuyShipNew(playerId, pending.targetShipName, v.name);
    } else {
        await executeBuyShipTradein(playerId, pending.targetShipName, v.name);
    }
    return { outcome: 'ok' };
}

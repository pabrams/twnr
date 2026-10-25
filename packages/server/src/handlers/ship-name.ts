import { ServerTag } from '@twnr/shared';
import type { SetShipNameCommand } from '@twnr/shared';
import { sendEnvelope, sendError } from '../state/messaging.js';
import {
    getPendingShipPurchase,
    clearPendingShipPurchase,
} from '../state/pending-ship-purchases.js';
import { executeBuyShipNew, executeBuyShipTradein } from './ship-exchange.js';
import { MAX_SHIP_NAME_LENGTH } from '../services/starting-ship.js';

function validateName(raw: string): { ok: true; name: string } | { ok: false; message: string } {
    const name = raw.trim();
    if (name.length === 0) return { ok: false, message: 'Ship name cannot be blank.' };
    if (name.length > MAX_SHIP_NAME_LENGTH) {
        return { ok: false, message: `Ship name too long (max ${MAX_SHIP_NAME_LENGTH}).` };
    }
    return { ok: true, name };
}

export async function serveSetShipName(playerId: number, data: SetShipNameCommand): Promise<void> {
    const v = validateName(data.name);
    if (!v.ok) {
        sendEnvelope(playerId, {
            type: ServerTag.SetShipNameResult,
            outcome: 'invalid',
            message: v.message,
        });
        return;
    }

    const pending = getPendingShipPurchase(playerId);
    if (!pending) {
        sendError(playerId, 'No ship purchase awaiting a name.');
        return;
    }
    clearPendingShipPurchase(playerId);
    sendEnvelope(playerId, { type: ServerTag.SetShipNameResult, outcome: 'ok' });
    if (pending.kind === 'new') {
        await executeBuyShipNew(playerId, pending.targetShipName, v.name);
    } else {
        await executeBuyShipTradein(playerId, pending.targetShipName, v.name);
    }
}

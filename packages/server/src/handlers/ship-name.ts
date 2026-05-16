import { ServerTag } from '@twnr/shared';
import type { SetShipNameCommand } from '@twnr/shared';
import { players, getPlayerUniverseId } from '../state/players.js';
import { sendEnvelope, sendError } from '../state/messaging.js';
import { getStartingShipTypeBySlug, insertStartingShip } from '../db/queries/ship.js';
import { setPlayerShipId } from '../db/queries/player.js';
import { getUniverseTemplateDefaults } from '../db/queries/universe.js';
import { universeConfig } from '@twnr/shared';
import {
    getPendingShipPurchase,
    clearPendingShipPurchase,
} from '../state/pending-ship-purchases.js';
import { executeBuyShipNew, executeBuyShipTradein } from './ship-exchange.js';

const MAX_SHIP_NAME_LENGTH = 20;

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
    if (pending) {
        clearPendingShipPurchase(playerId);
        sendEnvelope(playerId, { type: ServerTag.SetShipNameResult, outcome: 'ok' });
        if (pending.kind === 'new') {
            await executeBuyShipNew(playerId, pending.targetShipName, v.name);
        } else {
            await executeBuyShipTradein(playerId, pending.targetShipName, v.name);
        }
        return;
    }

    const player = players[playerId];
    if (!player || player.shipId !== null) {
        sendError(playerId, 'No ship needs naming.');
        return;
    }

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) {
        sendError(playerId, 'Player not in a universe.');
        return;
    }

    const templateDefaults = await getUniverseTemplateDefaults(universeId);
    if (!templateDefaults?.starter_ship_slug) {
        sendError(playerId, 'Universe missing starter ship configuration.');
        return;
    }
    const startShipName = templateDefaults.starter_ship_slug;
    const startingDrones = templateDefaults.starting_drones ?? universeConfig.startingDrones;

    const startShipType = await getStartingShipTypeBySlug(universeId, startShipName);
    if (!startShipType) {
        sendError(playerId, 'Starting ship type not configured.');
        return;
    }

    const newShipId = await insertStartingShip(
        playerId,
        universeId,
        startShipType.slug,
        player.sectorId,
        startingDrones,
        universeConfig.startingShields,
        startShipType.starting_holds,
        startShipType.turns_per_warp,
        v.name,
    );
    await setPlayerShipId(playerId, newShipId);
    player.shipId = newShipId;

    sendEnvelope(playerId, { type: ServerTag.SetShipNameResult, outcome: 'ok' });
}

import { ServerMsgType, type BuyHardwareResultObject } from '@twnr/shared';
import { players, setPlayerMenu } from '../state/players.js';
import { sendEnvelope, sendError } from '../state/messaging.js';
import { withTransaction, AbortTransaction } from '../db/index.js';
import { getCreditsForUpdate, deductCredits } from '../db/queries/player.js';
import {
    getHardwareItemByName,
    getHardwarePriceForUniverse,
    getShipHardwareCapacityForUpdate,
    upsertShipHardwareQuantity,
    setShipHardwareInstalled,
    getHardwareStoreRows,
    type HardwareItemRow,
} from '../db/queries/hardware.js';

/**
 * Pre-fetch for the hardware store UI: current credits and every hardware item
 * with per-universe price, ship's current quantity, and ship-type maximum.
 * Also transitions the player into the starbaseHardware menu.
 */
export async function handleHardwareStoreInfo(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player?.at_starbase) {
        sendError(playerId, 'Not at Starbase');
        return;
    }

    const rows = await getHardwareStoreRows(playerId, player.universeId);
    const credits = rows[0]?.credits ?? 0;
    const items = rows.map((r) => ({
        name: r.name,
        label: r.label,
        kind: r.kind,
        price: r.price,
        currentQty: r.current_qty,
        maxQty: r.max_qty,
    }));

    await sendEnvelope(
        playerId,
        { type: ServerMsgType.HardwareStoreInfoResult, credits, items },
        'starbaseHardware',
    );
}

/** Unified handler for buying any hardware item. */
export async function handleBuyHardware(
    playerId: number,
    itemName: string,
    quantity?: number,
): Promise<void> {
    const player = players[playerId];
    if (!player?.at_starbase) {
        sendError(playerId, 'Not at Starbase');
        return;
    }

    // Return the player to the hardware store menu BEFORE doing the work, so any
    // sendError below carries the corrected menu in its envelope.
    await setPlayerMenu(playerId, 'starbaseHardware');

    const hw = await getHardwareItemByName(itemName);
    if (!hw) {
        sendError(playerId, 'Unknown hardware item');
        return;
    }

    const priceOverride = await getHardwarePriceForUniverse(player.universeId, hw.id);
    const unitPrice = priceOverride ?? hw.default_price;

    if (hw.kind === 'stackable') {
        await buyStackable(playerId, hw, unitPrice, quantity ?? 0);
    } else {
        await buyToggle(playerId, hw, unitPrice);
    }
}

async function buyStackable(
    playerId: number,
    hw: HardwareItemRow,
    unitPrice: number,
    quantity: number,
): Promise<void> {
    const qty = Number.isInteger(quantity) ? quantity : 0;
    if (qty <= 0) {
        sendError(playerId, 'Invalid quantity');
        return;
    }

    const cost = qty * unitPrice;
    try {
        const result = await withTransaction(async (client) => {
            const capacity = await getShipHardwareCapacityForUpdate(playerId, hw.id, client);
            if (!capacity) {
                sendError(playerId, 'Ship not found');
                throw new AbortTransaction();
            }

            const { ship_id, current_qty, max_qty } = capacity;

            if (max_qty <= 0) {
                sendError(playerId, `Your ship cannot carry ${hw.label}`);
                throw new AbortTransaction();
            }

            if (current_qty + qty > max_qty) {
                sendError(playerId, `Cannot hold that many ${hw.label} (max ${max_qty})`);
                throw new AbortTransaction();
            }

            const credits = await getCreditsForUpdate(playerId, client);
            if (credits === undefined || credits < cost) {
                sendError(playerId, 'Insufficient credits');
                throw new AbortTransaction();
            }

            await deductCredits(playerId, cost, client);
            await upsertShipHardwareQuantity(ship_id, hw.id, qty, client);
            return { credits, current_qty };
        });

        if (!result) return;

        await sendEnvelope(
            playerId,
            {
                type: ServerMsgType.BuyHardwareResult,
                itemName: hw.name,
                label: hw.label,
                kind: 'stackable',
                quantity: qty,
                totalOnShip: result.current_qty + qty,
                credits: result.credits - cost,
                cost,
                ...(hw.result_extra ?? {}),
            } as BuyHardwareResultObject,
            'starbaseHardware',
        );
    } catch (err) {
        console.error('Buy hardware error', err);
        sendError(playerId, 'Internal server error');
    }
}

async function buyToggle(playerId: number, hw: HardwareItemRow, unitPrice: number): Promise<void> {
    try {
        const result = await withTransaction(async (client) => {
            const capacity = await getShipHardwareCapacityForUpdate(playerId, hw.id, client);
            if (!capacity) {
                sendError(playerId, 'Ship not found');
                throw new AbortTransaction();
            }

            if (capacity.max_qty <= 0) {
                sendError(playerId, `Ship cannot equip ${hw.label}`);
                throw new AbortTransaction();
            }

            if (capacity.current_qty > 0) {
                sendError(playerId, `Ship already has ${hw.label}`);
                throw new AbortTransaction();
            }

            const credits = await getCreditsForUpdate(playerId, client);
            if (credits === undefined || credits < unitPrice) {
                sendError(playerId, 'Insufficient credits');
                throw new AbortTransaction();
            }

            await setShipHardwareInstalled(capacity.ship_id, hw.id, client);
            await deductCredits(playerId, unitPrice, client);
            return { credits };
        });

        if (!result) return;

        await sendEnvelope(
            playerId,
            {
                type: ServerMsgType.BuyHardwareResult,
                itemName: hw.name,
                label: hw.label,
                kind: 'toggle',
                credits: result.credits - unitPrice,
                cost: unitPrice,
                ...(hw.result_extra ?? {}),
            } as BuyHardwareResultObject,
            'starbaseHardware',
        );
    } catch (err) {
        console.error('Buy hardware error', err);
        sendError(playerId, 'Internal server error');
    }
}

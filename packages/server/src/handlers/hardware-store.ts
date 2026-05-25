import { ServerTag, type BuyHardwareReply } from '@twnr/shared';
import type { BuyHardwareCommand } from '@twnr/shared';
import { onlinePlayers } from '../state/players.js';
import { sendEnvelope, sendError } from '../state/messaging.js';
import { AbortTransaction } from '../db/index.js';
import { runMutation } from './run-mutation.js';
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
import { recordCreditChange } from '../services/audit.js';

/**
 * Pre-fetch for the hardware store UI: current credits and every hardware item
 * with per-universe price, ship's current quantity, and ship-type maximum.
 */
export async function serveHardwareStoreInfo(playerId: number): Promise<void> {
    const player = onlinePlayers[playerId];
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

    await sendEnvelope(playerId, {
        type: ServerTag.HardwareStoreInfoResult,
        credits,
        items,
    });
}

/** Unified handler for buying any hardware item. */
export async function serveBuyHardware(playerId: number, data: BuyHardwareCommand): Promise<void> {
    const { itemName, quantity } = data;
    const player = onlinePlayers[playerId];
    if (!player?.at_starbase) {
        sendError(playerId, 'Not at Starbase');
        return;
    }

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
    await runMutation(
        playerId,
        'Buy hardware',
        async (client) => {
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
            await recordCreditChange(client, {
                playerId,
                actionType: 'buy_hardware',
                delta: -cost,
                prevCredits: credits,
                newCredits: credits - cost,
                context: {
                    item: hw.name,
                    kind: 'stackable',
                    qty,
                    unitPrice,
                },
            });
            return { credits, current_qty };
        },
        (result) =>
            sendEnvelope(playerId, {
                type: ServerTag.BuyHardwareResult,
                itemName: hw.name,
                label: hw.label,
                kind: 'stackable',
                quantity: qty,
                totalOnShip: result.current_qty + qty,
                credits: result.credits - cost,
                cost,
                ...(hw.result_extra ?? {}),
            } as BuyHardwareReply),
    );
}

async function buyToggle(playerId: number, hw: HardwareItemRow, unitPrice: number): Promise<void> {
    await runMutation(
        playerId,
        'Buy hardware',
        async (client) => {
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
            await recordCreditChange(client, {
                playerId,
                actionType: 'buy_hardware',
                delta: -unitPrice,
                prevCredits: credits,
                newCredits: credits - unitPrice,
                context: {
                    item: hw.name,
                    kind: 'toggle',
                    unitPrice,
                },
            });
            return { credits };
        },
        (result) =>
            sendEnvelope(playerId, {
                type: ServerTag.BuyHardwareResult,
                itemName: hw.name,
                label: hw.label,
                kind: 'toggle',
                credits: result.credits - unitPrice,
                cost: unitPrice,
                ...(hw.result_extra ?? {}),
            } as BuyHardwareReply),
    );
}

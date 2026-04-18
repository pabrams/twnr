import { ServerMsgType, type BuyHardwareResultObject } from '@twnr/shared';
import { players, sendEnvelope, setPlayerMenu } from '../game-state.js';
import { withTransaction, AbortTransaction } from '../db/index.js';
import { getCreditsForUpdate, deductCredits } from '../db/queries/player.js';
import {
    getHardwareItemByName,
    getHardwarePriceForUniverse,
    getShipHardwareCapacityForUpdate,
    upsertShipHardwareQuantity,
    setShipHardwareInstalled,
    type HardwareItemRow,
} from '../db/queries/hardware.js';

/** Unified handler for buying any hardware item. */
export async function handleBuyHardware(
    playerId: number,
    itemName: string,
    quantity?: number,
): Promise<void> {
    const player = players[playerId];
    if (!player?.at_starbase) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Not at Starbase' });
        return;
    }

    const hw = await getHardwareItemByName(itemName);
    if (!hw) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Unknown hardware item' });
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
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Invalid quantity' });
        return;
    }

    const cost = qty * unitPrice;
    try {
        const result = await withTransaction(async (client) => {
            const capacity = await getShipHardwareCapacityForUpdate(playerId, hw.id, client);
            if (!capacity) {
                sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Ship not found' });
                throw new AbortTransaction();
            }

            const { ship_id, current_qty, max_qty } = capacity;

            if (max_qty <= 0) {
                sendEnvelope(playerId, {
                    type: ServerMsgType.Error,
                    message: `Your ship cannot carry ${hw.label}`,
                });
                throw new AbortTransaction();
            }

            if (current_qty + qty > max_qty) {
                sendEnvelope(playerId, {
                    type: ServerMsgType.Error,
                    message: `Cannot hold that many ${hw.label} (max ${max_qty})`,
                });
                throw new AbortTransaction();
            }

            const credits = await getCreditsForUpdate(playerId, client);
            if (credits === undefined || credits < cost) {
                sendEnvelope(playerId, {
                    type: ServerMsgType.Error,
                    message: 'Insufficient credits',
                });
                throw new AbortTransaction();
            }

            await deductCredits(playerId, cost, client);
            await upsertShipHardwareQuantity(ship_id, hw.id, qty, client);
            return { credits, current_qty };
        });

        if (!result) return;

        await setPlayerMenu(playerId, 'starbaseHardware');
        sendEnvelope(playerId, {
            type: ServerMsgType.BuyHardwareResult,
            itemName: hw.name,
            label: hw.label,
            kind: 'stackable',
            quantity: qty,
            totalOnShip: result.current_qty + qty,
            credits: result.credits - cost,
            ...(hw.result_extra ?? {}),
        } as BuyHardwareResultObject);
    } catch (err) {
        console.error('Buy hardware error', err);
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Internal server error' });
    }
}

async function buyToggle(playerId: number, hw: HardwareItemRow, unitPrice: number): Promise<void> {
    try {
        const result = await withTransaction(async (client) => {
            const capacity = await getShipHardwareCapacityForUpdate(playerId, hw.id, client);
            if (!capacity) {
                sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Ship not found' });
                throw new AbortTransaction();
            }

            if (capacity.max_qty <= 0) {
                sendEnvelope(playerId, {
                    type: ServerMsgType.Error,
                    message: `Ship cannot equip ${hw.label}`,
                });
                throw new AbortTransaction();
            }

            if (capacity.current_qty > 0) {
                sendEnvelope(playerId, {
                    type: ServerMsgType.Error,
                    message: `Ship already has ${hw.label}`,
                });
                throw new AbortTransaction();
            }

            const credits = await getCreditsForUpdate(playerId, client);
            if (credits === undefined || credits < unitPrice) {
                sendEnvelope(playerId, {
                    type: ServerMsgType.Error,
                    message: 'Insufficient credits',
                });
                throw new AbortTransaction();
            }

            await setShipHardwareInstalled(capacity.ship_id, hw.id, client);
            await deductCredits(playerId, unitPrice, client);
            return { credits };
        });

        if (!result) return;

        await setPlayerMenu(playerId, 'starbaseHardware');
        sendEnvelope(playerId, {
            type: ServerMsgType.BuyHardwareResult,
            itemName: hw.name,
            label: hw.label,
            kind: 'toggle',
            credits: result.credits - unitPrice,
            ...(hw.result_extra ?? {}),
        } as BuyHardwareResultObject);
    } catch (err) {
        console.error('Buy hardware error', err);
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Internal server error' });
    }
}

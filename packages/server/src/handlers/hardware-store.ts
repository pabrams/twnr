import { type CommandReply } from '@twnr/shared';
import type { CommandRequest } from '@twnr/shared';
import { onlinePlayers } from '../state/players.js';

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
import { type CommandResult, commandRefusal, mutateAndReply } from './command.js';

export async function serveHardwareStoreInfo(
    playerId: number,
): Promise<CommandResult<'HardwareStoreInfo'>> {
    const player = onlinePlayers[playerId];
    if (!player?.at_starbase) {
        return commandRefusal('notAtStarbase');
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

    return { outcome: 'ok', credits, items };
}

export async function serveBuyHardware(
    playerId: number,
    data: CommandRequest<'BuyHardware'>,
): Promise<CommandResult<'BuyHardware'>> {
    const { itemName, quantity } = data;
    const player = onlinePlayers[playerId];
    if (!player?.at_starbase) {
        return commandRefusal('notAtStarbase');
    }

    const hw = await getHardwareItemByName(itemName);
    if (!hw) {
        return commandRefusal('unknownHardware');
    }

    const priceOverride = await getHardwarePriceForUniverse(player.universeId, hw.id);
    const unitPrice = priceOverride ?? hw.default_price;

    if (hw.kind === 'stackable') {
        return buyStackable(playerId, hw, unitPrice, quantity ?? 0);
    }
    return buyToggle(playerId, hw, unitPrice);
}

async function buyStackable(
    playerId: number,
    hw: HardwareItemRow,
    unitPrice: number,
    quantity: number,
): Promise<CommandResult<'BuyHardware'>> {
    const qty = Number.isInteger(quantity) ? quantity : 0;

    const cost = qty * unitPrice;
    return mutateAndReply(
        async (client, abort) => {
            const capacity = await getShipHardwareCapacityForUpdate(playerId, hw.id, client);
            if (!capacity) {
                throw abort(commandRefusal('noShip'));
            }

            const { ship_id, current_qty, max_qty } = capacity;

            if (max_qty <= 0) {
                throw abort(commandRefusal('cannotCarry', { item: hw.label }));
            }

            if (current_qty + qty > max_qty) {
                throw abort(commandRefusal('hardwareAtMax', { item: hw.label, max: max_qty }));
            }

            const credits = await getCreditsForUpdate(playerId, client);
            if (credits === undefined || credits < cost) {
                throw abort(commandRefusal('insufficientCredits'));
            }

            await deductCredits(playerId, cost, client);
            await upsertShipHardwareQuantity(ship_id, hw.id, qty, client);
            return { credits, current_qty };
        },
        (result) =>
            ({
                itemName: hw.name,
                label: hw.label,
                kind: 'stackable',
                quantity: qty,
                totalOnShip: result.current_qty + qty,
                credits: result.credits - cost,
                cost,
                ...(hw.result_extra ?? {}),
            }) as CommandReply<'BuyHardware'>,
    );
}

async function buyToggle(
    playerId: number,
    hw: HardwareItemRow,
    unitPrice: number,
): Promise<CommandResult<'BuyHardware'>> {
    return mutateAndReply(
        async (client, abort) => {
            const capacity = await getShipHardwareCapacityForUpdate(playerId, hw.id, client);
            if (!capacity) {
                throw abort(commandRefusal('noShip'));
            }

            if (capacity.max_qty <= 0) {
                throw abort(commandRefusal('cannotCarry', { item: hw.label }));
            }

            if (capacity.current_qty > 0) {
                throw abort(commandRefusal('alreadyInstalled', { item: hw.label }));
            }

            const credits = await getCreditsForUpdate(playerId, client);
            if (credits === undefined || credits < unitPrice) {
                throw abort(commandRefusal('insufficientCredits'));
            }

            await setShipHardwareInstalled(capacity.ship_id, hw.id, client);
            await deductCredits(playerId, unitPrice, client);
            return { credits };
        },
        (result) =>
            ({
                itemName: hw.name,
                label: hw.label,
                kind: 'toggle',
                credits: result.credits - unitPrice,
                cost: unitPrice,
                ...(hw.result_extra ?? {}),
            }) as CommandReply<'BuyHardware'>,
    );
}

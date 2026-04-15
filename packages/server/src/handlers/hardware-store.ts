import { ServerMsgType, type BuyHardwareResultObject } from '@twnr/shared';
import { players, sendEnvelope, setPlayerMenu } from '../game-state.js';
import { pool } from '../db/index.js';

/** Get hardware price for a universe: check hardware_price for the edit, fall back to default_price. */
async function getHardwarePrice(
    universeId: number,
    hardwareItemId: number,
    defaultPrice: number,
): Promise<number> {
    const res = await pool.query(
        `SELECT hp.price FROM hardware_price hp
         JOIN universes u ON u.edit_id = hp.edit_id
         WHERE u.id = $1 AND hp.hardware_item_id = $2`,
        [universeId, hardwareItemId],
    );
    return res.rows[0]?.price ?? defaultPrice;
}

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

    // Look up the hardware item
    const hwRes = await pool.query(
        'SELECT id, name, label, kind, default_price, result_extra FROM hardware_item WHERE name = $1',
        [itemName],
    );
    if (hwRes.rows.length === 0) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Unknown hardware item' });
        return;
    }
    const hw = hwRes.rows[0];

    const unitPrice = await getHardwarePrice(player.universeId, hw.id, hw.default_price);

    if (hw.kind === 'stackable') {
        await buyStackable(playerId, hw, unitPrice, quantity ?? 0);
    } else {
        await buyToggle(playerId, hw, unitPrice);
    }
}

async function buyStackable(
    playerId: number,
    hw: {
        id: number;
        name: string;
        label: string;
        kind: string;
        result_extra: Record<string, unknown> | null;
    },
    unitPrice: number,
    quantity: number,
): Promise<void> {
    const qty = Number.isInteger(quantity) ? quantity : 0;
    if (qty <= 0) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Invalid quantity' });
        return;
    }

    const cost = qty * unitPrice;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Get ship id and current quantity
        const shipRes = await client.query(
            `SELECT s.id as ship_id,
                    COALESCE(sh.quantity, 0) as current_qty,
                    COALESCE(sth.max_quantity, 0) as max_qty
             FROM ships s
             LEFT JOIN ship_hardware sh ON sh.ship_id = s.id AND sh.hardware_item_id = $2
             LEFT JOIN ship_type_hardware sth ON sth.ship_type_id = s.ship_type_id AND sth.hardware_item_id = $2
             WHERE s.id = (SELECT ship_id FROM players WHERE id = $1)
             FOR UPDATE OF s`,
            [playerId, hw.id],
        );
        if (shipRes.rows.length === 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Ship not found' });
            return;
        }

        const { ship_id, current_qty, max_qty } = shipRes.rows[0];

        if (max_qty <= 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, {
                type: ServerMsgType.Error,
                message: `Your ship cannot carry ${hw.label}`,
            });
            return;
        }

        if (current_qty + qty > max_qty) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, {
                type: ServerMsgType.Error,
                message: `Cannot hold that many ${hw.label} (max ${max_qty})`,
            });
            return;
        }

        const credRes = await client.query('SELECT credits FROM players WHERE id = $1 FOR UPDATE', [
            playerId,
        ]);
        if (credRes.rows.length === 0 || credRes.rows[0].credits < cost) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Insufficient credits' });
            return;
        }

        await client.query('UPDATE players SET credits = credits - $1 WHERE id = $2', [
            cost,
            playerId,
        ]);
        await client.query(
            `INSERT INTO ship_hardware (ship_id, hardware_item_id, quantity)
             VALUES ($1, $2, $3)
             ON CONFLICT (ship_id, hardware_item_id) DO UPDATE SET quantity = ship_hardware.quantity + $3`,
            [ship_id, hw.id, qty],
        );
        await client.query('COMMIT');

        await setPlayerMenu(playerId, 'starbaseHardware');
        sendEnvelope(playerId, {
            type: ServerMsgType.BuyHardwareResult,
            itemName: hw.name,
            label: hw.label,
            kind: 'stackable',
            quantity: qty,
            totalOnShip: current_qty + qty,
            credits: credRes.rows[0].credits - cost,
            ...(hw.result_extra ?? {}),
        } as BuyHardwareResultObject);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Buy hardware error', err);
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
    }
}

async function buyToggle(
    playerId: number,
    hw: {
        id: number;
        name: string;
        label: string;
        kind: string;
        result_extra: Record<string, unknown> | null;
    },
    unitPrice: number,
): Promise<void> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const shipRes = await client.query(
            `SELECT s.id as ship_id,
                    COALESCE(sh.quantity, 0) as has_item,
                    COALESCE(sth.max_quantity, 0) as can_have
             FROM ships s
             LEFT JOIN ship_hardware sh ON sh.ship_id = s.id AND sh.hardware_item_id = $2
             LEFT JOIN ship_type_hardware sth ON sth.ship_type_id = s.ship_type_id AND sth.hardware_item_id = $2
             WHERE s.id = (SELECT ship_id FROM players WHERE id = $1)
             FOR UPDATE OF s`,
            [playerId, hw.id],
        );
        if (shipRes.rows.length === 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Ship not found' });
            return;
        }

        if (!shipRes.rows[0].can_have) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, {
                type: ServerMsgType.Error,
                message: `Ship cannot equip ${hw.label}`,
            });
            return;
        }

        if (shipRes.rows[0].has_item > 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, {
                type: ServerMsgType.Error,
                message: `Ship already has ${hw.label}`,
            });
            return;
        }

        const credRes = await client.query('SELECT credits FROM players WHERE id = $1 FOR UPDATE', [
            playerId,
        ]);
        if (credRes.rows.length === 0 || credRes.rows[0].credits < unitPrice) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Insufficient credits' });
            return;
        }

        await client.query(
            `INSERT INTO ship_hardware (ship_id, hardware_item_id, quantity)
             VALUES ($1, $2, 1)
             ON CONFLICT (ship_id, hardware_item_id) DO UPDATE SET quantity = 1`,
            [shipRes.rows[0].ship_id, hw.id],
        );
        await client.query('UPDATE players SET credits = credits - $1 WHERE id = $2', [
            unitPrice,
            playerId,
        ]);
        await client.query('COMMIT');

        await setPlayerMenu(playerId, 'starbaseHardware');
        sendEnvelope(playerId, {
            type: ServerMsgType.BuyHardwareResult,
            itemName: hw.name,
            label: hw.label,
            kind: 'toggle',
            credits: credRes.rows[0].credits - unitPrice,
            ...(hw.result_extra ?? {}),
        } as BuyHardwareResultObject);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Buy hardware error', err);
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
    }
}

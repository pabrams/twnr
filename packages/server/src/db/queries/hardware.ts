import { pool } from '../index.js';
import type { Queryable, HardwareRow, HardwareMaxRow } from '../types.js';

export type HardwareItemRow = {
    id: number;
    name: string;
    label: string;
    kind: string;
    default_price: number;
    result_extra: Record<string, unknown> | null;
};

/** Look up a hardware item by its programmatic name (e.g. 'hyperspace_1'). */
export async function getHardwareItemByName(
    itemName: string,
    db: Queryable = pool,
): Promise<HardwareItemRow | undefined> {
    const res = await db.query<HardwareItemRow>(
        'SELECT id, name, label, kind, default_price, result_extra FROM hardware_item WHERE name = $1',
        [itemName],
    );
    return res.rows[0];
}

/** Catalog of all hardware items (name + label + kind), for the hardware-store UI. */
export async function listHardwareCatalog(
    db: Queryable = pool,
): Promise<{ name: string; label: string; kind: string }[]> {
    const res = await db.query<{ name: string; label: string; kind: string }>(
        'SELECT name, label, kind FROM hardware_item ORDER BY id',
    );
    return res.rows;
}

/** One-shot: player credits + every hardware item with per-universe price, ship's current qty, ship-type max. */
export type HardwareStoreRow = {
    credits: number;
    name: string;
    label: string;
    kind: 'stackable' | 'toggle';
    price: number;
    current_qty: number;
    max_qty: number;
};
export async function getHardwareStoreRows(
    playerId: number,
    universeId: number,
    db: Queryable = pool,
): Promise<HardwareStoreRow[]> {
    const res = await db.query<HardwareStoreRow>(
        `SELECT p.credits,
                hi.name,
                hi.label,
                hi.kind,
                COALESCE(hp.price, hi.default_price) AS price,
                COALESCE(sh.quantity, 0) AS current_qty,
                COALESCE(sth.max_quantity, 0) AS max_qty
         FROM players p
         JOIN ships s ON s.id = p.ship_id
         CROSS JOIN hardware_item hi
         LEFT JOIN hardware_price hp
           ON hp.hardware_item_id = hi.id
           AND hp.template_id = (SELECT template_id FROM universes WHERE id = $2)
         LEFT JOIN ship_hardware sh
           ON sh.ship_id = s.id AND sh.hardware_item_id = hi.id
         LEFT JOIN ship_type_hardware sth
           ON sth.ship_type_id = s.ship_type_id AND sth.hardware_item_id = hi.id
         WHERE p.id = $1
         ORDER BY hi.id`,
        [playerId, universeId],
    );
    return res.rows;
}

/** Resolve the hardware price for a universe, falling back to the item's default. */
export async function getHardwarePriceForUniverse(
    universeId: number,
    hardwareItemId: number,
    db: Queryable = pool,
): Promise<number | undefined> {
    const res = await db.query<{ price: number }>(
        `SELECT hp.price FROM hardware_price hp
         JOIN universes u ON u.template_id = hp.template_id
         WHERE u.id = $1 AND hp.hardware_item_id = $2`,
        [universeId, hardwareItemId],
    );
    return res.rows[0]?.price;
}

/** Ship + current-hardware-qty + max-allowed row, locked for update on the ship. */
export type ShipHardwareCapacityRow = {
    ship_id: number;
    current_qty: number;
    max_qty: number;
};
export async function getShipHardwareCapacityForUpdate(
    playerId: number,
    hardwareItemId: number,
    db: Queryable = pool,
): Promise<ShipHardwareCapacityRow | undefined> {
    const res = await db.query<ShipHardwareCapacityRow>(
        `SELECT s.id as ship_id,
                COALESCE(sh.quantity, 0) as current_qty,
                COALESCE(sth.max_quantity, 0) as max_qty
         FROM ships s
         LEFT JOIN ship_hardware sh ON sh.ship_id = s.id AND sh.hardware_item_id = $2
         LEFT JOIN ship_type_hardware sth ON sth.ship_type_id = s.ship_type_id AND sth.hardware_item_id = $2
         WHERE s.id = (SELECT ship_id FROM players WHERE id = $1)
         FOR UPDATE OF s`,
        [playerId, hardwareItemId],
    );
    return res.rows[0];
}

/** Add quantity to a ship's hardware stack (insert if none). */
export async function upsertShipHardwareQuantity(
    shipId: number,
    hardwareItemId: number,
    additionalQty: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `INSERT INTO ship_hardware (ship_id, hardware_item_id, quantity)
         VALUES ($1, $2, $3)
         ON CONFLICT (ship_id, hardware_item_id) DO UPDATE SET quantity = ship_hardware.quantity + $3`,
        [shipId, hardwareItemId, additionalQty],
    );
}

/** Set a ship's toggle-hardware to installed (quantity = 1). */
export async function setShipHardwareInstalled(
    shipId: number,
    hardwareItemId: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `INSERT INTO ship_hardware (ship_id, hardware_item_id, quantity)
         VALUES ($1, $2, 1)
         ON CONFLICT (ship_id, hardware_item_id) DO UPDATE SET quantity = 1`,
        [shipId, hardwareItemId],
    );
}

/** Fetch the quantity of a named hardware item on a player's ship (0 if not installed). */
export async function getShipHardwareQuantityByName(
    playerId: number,
    itemName: string,
    db: Queryable = pool,
): Promise<number> {
    const res = await db.query<{ quantity: number }>(
        `SELECT COALESCE(sh.quantity, 0) as quantity FROM ships s
         LEFT JOIN ship_hardware sh ON sh.ship_id = s.id
           AND sh.hardware_item_id = (SELECT id FROM hardware_item WHERE name = $2)
         WHERE s.id = (SELECT ship_id FROM players WHERE id = $1)`,
        [playerId, itemName],
    );
    return res.rows[0]?.quantity ?? 0;
}

/** Decrement a ship's hardware-item count by an explicit quantity.
 *  Caller is expected to have verified the ship currently holds at least
 *  this many (no underflow guard here). */
export async function decrementShipHardwareQuantity(
    shipId: number,
    hardwareItemId: number,
    quantity: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `UPDATE ship_hardware SET quantity = quantity - $1
         WHERE ship_id = $2 AND hardware_item_id = $3`,
        [quantity, shipId, hardwareItemId],
    );
}

/** Decrement a named hardware item's quantity on a player's ship by 1. */
export async function decrementShipHardwareByName(
    playerId: number,
    itemName: string,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `UPDATE ship_hardware SET quantity = quantity - 1
         WHERE hardware_item_id = (SELECT id FROM hardware_item WHERE name = $2)
           AND ship_id = (SELECT ship_id FROM players WHERE id = $1)`,
        [playerId, itemName],
    );
}

export async function getShipHardwareQuantities(
    shipId: number,
    db: Queryable = pool,
): Promise<HardwareRow[]> {
    const res = await db.query<HardwareRow>(
        `SELECT hi.name, COALESCE(sh.quantity, 0) as quantity
         FROM hardware_item hi
         LEFT JOIN ship_hardware sh ON sh.hardware_item_id = hi.id AND sh.ship_id = $1`,
        [shipId],
    );
    return res.rows;
}

export async function getShipTypeHardwareMax(
    shipTypeId: number,
    db: Queryable = pool,
): Promise<HardwareMaxRow[]> {
    const res = await db.query<HardwareMaxRow>(
        `SELECT hi.name, COALESCE(sth.max_quantity, 0) as max_quantity
         FROM hardware_item hi
         LEFT JOIN ship_type_hardware sth ON sth.hardware_item_id = hi.id AND sth.ship_type_id = $1`,
        [shipTypeId],
    );
    return res.rows;
}

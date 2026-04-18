import { pool } from '../index.js';
import type { Queryable, HardwareRow, HardwareMaxRow } from '../types.js';

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

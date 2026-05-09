import { pool } from '../index.js';
import type { Queryable, ShipTypeRow, ShipTypeHardwareJoinRow } from '../types.js';

/** All ship_types rows ordered for display (catalog API). */
export async function listShipTypes(db: Queryable = pool): Promise<ShipTypeRow[]> {
    const res = await db.query<ShipTypeRow>('SELECT * FROM ship_types ORDER BY sort_order, id');
    return res.rows;
}

/** All ship-type → hardware max-quantity rows (for per-type capacity map). */
export async function listShipTypeHardware(
    db: Queryable = pool,
): Promise<ShipTypeHardwareJoinRow[]> {
    const res = await db.query<ShipTypeHardwareJoinRow>(
        `SELECT sth.ship_type_id, hi.name, sth.max_quantity
         FROM ship_type_hardware sth
         JOIN hardware_item hi ON hi.id = sth.hardware_item_id`,
    );
    return res.rows;
}

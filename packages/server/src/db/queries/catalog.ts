import { pool } from '../index.js';
import type {
    Queryable,
    ShipTypeRow,
    ShipTypeHardwareJoinRow,
    MenuRow,
    MenuCommandRow,
} from '../types.js';

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

/** All menu rows (for menu registry). */
export async function listMenus(db: Queryable = pool): Promise<MenuRow[]> {
    const res = await db.query<MenuRow>(
        `SELECT id, name, label, parent_menu_id FROM menu ORDER BY id`,
    );
    return res.rows;
}

/** All menu-command rows with joined command name/label (for menu registry). */
export async function listMenuCommands(db: Queryable = pool): Promise<MenuCommandRow[]> {
    const res = await db.query<MenuCommandRow>(
        `SELECT mc.menu_id, mc.command_id, mc.key_pattern, mc.label as mc_label,
                mc.client_msg_type, mc.target_menu_id, mc.sort_order,
                c.name as command_name, c.label as command_label
         FROM menu_command mc
         JOIN command c ON mc.command_id = c.id
         ORDER BY mc.menu_id, mc.sort_order`,
    );
    return res.rows;
}

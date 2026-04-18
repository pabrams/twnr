import { pool } from '../index.js';
import type { Queryable } from '../types.js';

/** Check whether a menu transition (source → target) is allowed by menu_command. */
export async function canTransitionToMenu(
    fromMenu: string,
    toMenu: string,
    db: Queryable = pool,
): Promise<boolean> {
    const res = await db.query(
        `SELECT 1
         FROM menu_command mc
         JOIN menu src ON mc.menu_id = src.id
         JOIN menu t ON mc.target_menu_id = t.id
         WHERE src.name = $1 AND t.name = $2`,
        [fromMenu, toMenu],
    );
    return res.rows.length > 0;
}

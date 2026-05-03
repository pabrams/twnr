import { pool } from '../index.js';
import type { Queryable } from '../types.js';

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

/** Resolve a menu name to its parent menu name, or null at the root. */
export async function getParentMenuName(
    menuName: string,
    db: Queryable = pool,
): Promise<string | null> {
    const res = await db.query<{ parent: string | null }>(
        `SELECT p.name AS parent
         FROM menu m LEFT JOIN menu p ON p.id = m.parent_menu_id
         WHERE m.name = $1`,
        [menuName],
    );
    return res.rows[0]?.parent ?? null;
}

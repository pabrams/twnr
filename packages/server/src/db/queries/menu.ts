import { pool } from '../index.js';
import type { Queryable } from '../types.js';

/**
 * Validate that a ChangeMenu request is allowed. Server-driven menus
 * (with menu_command rows) only permit transitions whose target appears
 * in their rows. Client-driven menus (no menu_command rows — hardware,
 * planetEarth, …) own their own dispatch, so the server trusts them to
 * know where they're going; we just verify the target menu exists.
 */
export async function canTransitionToMenu(
    fromMenu: string,
    toMenu: string,
    db: Queryable = pool,
): Promise<boolean> {
    const res = await db.query<{ src_cmd_count: number; tgt_exists: boolean }>(
        `SELECT
             (SELECT COUNT(*)::int FROM menu_command mc
              JOIN menu src ON mc.menu_id = src.id
              WHERE src.name = $1) AS src_cmd_count,
             EXISTS (SELECT 1 FROM menu WHERE name = $2) AS tgt_exists,
             EXISTS (
                 SELECT 1 FROM menu_command mc
                 JOIN menu src ON mc.menu_id = src.id
                 JOIN menu t ON mc.target_menu_id = t.id
                 WHERE src.name = $1 AND t.name = $2
             ) AS allowed_via_row`,
        [fromMenu, toMenu],
    );
    const row = res.rows[0] as
        | { src_cmd_count: number; tgt_exists: boolean; allowed_via_row: boolean }
        | undefined;
    if (!row || !row.tgt_exists) return false;
    // Client-driven source: no rows at all → allow any existing target.
    if (row.src_cmd_count === 0) return true;
    return row.allowed_via_row;
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

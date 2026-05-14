import { pool } from '../index.js';
import type { Queryable } from '../types.js';

export type DensityScanRow = {
    to_sector_id: number;
    sector_number: number;
    visited: boolean;
    port_count: number;
    ship_count: number;
    planet_count: number;
    drone_qty: number;
    prox_qty: number;
    limpet_qty: number;
    has_beacon: boolean;
    warp_count: number;
};

/** One row per out-warp from `fromSectorDbId`, with aggregate counts the
 *  density-scan handler weights into a score. `visited` is computed for
 *  the calling player. */
export async function getDensityScanRows(
    fromSectorDbId: number,
    playerId: number,
    db: Queryable = pool,
): Promise<DensityScanRow[]> {
    const res = await db.query<DensityScanRow>(
        `SELECT s.id AS to_sector_id, s.sector_number,
                (vs.player_id IS NOT NULL) AS visited,
                (SELECT COUNT(*)::int FROM ports        WHERE sector_id = s.id) AS port_count,
                (SELECT COUNT(*)::int FROM ships        WHERE sector_id = s.id) AS ship_count,
                (SELECT COUNT(*)::int FROM planets      WHERE sector_id = s.id) AS planet_count,
                COALESCE((SELECT quantity FROM sector_drones WHERE sector_id = s.id), 0) AS drone_qty,
                COALESCE((SELECT quantity FROM sector_mines  WHERE sector_id = s.id AND mine_type = 'proximity'), 0) AS prox_qty,
                COALESCE((SELECT quantity FROM sector_mines  WHERE sector_id = s.id AND mine_type = 'seeker'),    0) AS limpet_qty,
                EXISTS(SELECT 1 FROM sector_beacons WHERE sector_id = s.id) AS has_beacon,
                (SELECT COUNT(*)::int FROM warps WHERE from_sector_id = s.id) AS warp_count
         FROM warps w
         JOIN sectors s ON s.id = w.to_sector_id
         LEFT JOIN player_visited_sectors vs ON vs.sector_id = s.id AND vs.player_id = $2
         WHERE w.from_sector_id = $1
         ORDER BY s.sector_number`,
        [fromSectorDbId, playerId],
    );
    return res.rows;
}

/** Out-warp sector numbers from `fromSectorDbId` — used by visual scan to
 *  iterate sectors to paint. */
export async function getOutWarpSectorNumbers(
    fromSectorDbId: number,
    db: Queryable = pool,
): Promise<number[]> {
    const res = await db.query<{ sector_number: number }>(
        `SELECT s.sector_number
         FROM warps w
         JOIN sectors s ON s.id = w.to_sector_id
         WHERE w.from_sector_id = $1
         ORDER BY s.sector_number`,
        [fromSectorDbId],
    );
    return res.rows.map((r) => r.sector_number);
}

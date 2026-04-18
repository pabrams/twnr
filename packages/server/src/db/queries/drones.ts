import { pool } from '../index.js';
import type { Queryable, DeployedDroneRow } from '../types.js';

export async function getDeployedDronesByOwner(
    playerId: number,
    db: Queryable = pool,
): Promise<DeployedDroneRow[]> {
    const res = await db.query<DeployedDroneRow>(
        `SELECT s.sector_number as sector_id, sf.quantity
         FROM sector_drones sf
         JOIN sectors s ON sf.sector_id = s.id
         WHERE sf.owner_id = $1 AND sf.quantity > 0`,
        [playerId],
    );
    return res.rows;
}

/** Check whether a player has drones deployed in a specific sector. */
export async function getDeployedDronesByOwnerBySector(
    sectorNumber: number,
    playerId: number,
    db: Queryable = pool,
): Promise<number> {
    const res = await db.query<{ quantity: number }>(
        `SELECT sf.quantity FROM sector_drones sf
         JOIN sectors s ON sf.sector_id = s.id
         WHERE s.sector_number = $1 AND sf.owner_id = $2 AND sf.quantity > 0`,
        [sectorNumber, playerId],
    );
    return res.rows[0]?.quantity ?? 0;
}

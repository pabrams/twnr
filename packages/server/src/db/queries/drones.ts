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

export async function getSectorDronesRowForUpdate(
    sectorDbId: number,
    db: Queryable = pool,
): Promise<{ quantity: number; owner_id: number } | undefined> {
    const res = await db.query<{ quantity: number; owner_id: number }>(
        'SELECT quantity, owner_id FROM sector_drones WHERE sector_id = $1 FOR UPDATE',
        [sectorDbId],
    );
    return res.rows[0];
}

export async function updateSectorDroneQuantity(
    sectorDbId: number,
    ownerId: number,
    quantity: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        'UPDATE sector_drones SET quantity = $1 WHERE sector_id = $2 AND owner_id = $3',
        [quantity, sectorDbId, ownerId],
    );
}

/** Insert a new sector_drones row. */
export async function insertSectorDrones(
    sectorDbId: number,
    ownerId: number,
    quantity: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        'INSERT INTO sector_drones (sector_id, owner_id, quantity) VALUES ($1, $2, $3)',
        [sectorDbId, ownerId, quantity],
    );
}

export async function deleteSectorDrones(
    sectorDbId: number,
    ownerId: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query('DELETE FROM sector_drones WHERE sector_id = $1 AND owner_id = $2', [
        sectorDbId,
        ownerId,
    ]);
}

/** True iff the sector contains drones owned by anyone other than the
 *  given player (including rogue drones, which have owner_id NULL). */
export async function hasEnemyDronesInSector(
    sectorNumber: number,
    universeId: number,
    selfPlayerId: number,
    db: Queryable = pool,
): Promise<boolean> {
    const res = await db.query(
        `SELECT 1 FROM sector_drones sf
         JOIN sectors s ON sf.sector_id = s.id
         WHERE s.sector_number = $1 AND s.universe_id = $2
           AND (sf.owner_id IS NULL OR sf.owner_id != $3)
           AND sf.quantity > 0
         LIMIT 1`,
        [sectorNumber, universeId, selfPlayerId],
    );
    return res.rows.length > 0;
}

/** Sector-drones display info: quantity + owner info (or 'Rogue' if unowned). */
export async function getSectorDroneDisplayInfo(
    sectorNumber: number,
    universeId: number,
    db: Queryable = pool,
): Promise<{ quantity: number; ownerId: number | null; ownerName: string } | null> {
    const res = await db.query<{
        quantity: number;
        owner_id: number | null;
        owner_name: string;
    }>(
        `SELECT sf.quantity, sf.owner_id, COALESCE(p.name, 'Rogue') as owner_name
         FROM sector_drones sf
         JOIN sectors s ON sf.sector_id = s.id
         LEFT JOIN players p ON sf.owner_id = p.id
         WHERE s.sector_number = $1 AND s.universe_id = $2 AND sf.quantity > 0`,
        [sectorNumber, universeId],
    );
    const row = res.rows[0];
    if (!row) return null;
    return { quantity: row.quantity, ownerId: row.owner_id, ownerName: row.owner_name };
}

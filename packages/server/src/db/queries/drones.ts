import { pool } from '../index.js';
import type { Queryable, DeployedDroneRow } from '../types.js';

export async function getDeployedDronesByOwner(
    playerId: number,
    db: Queryable = pool,
): Promise<DeployedDroneRow[]> {
    const res = await db.query<DeployedDroneRow>(
        `SELECT s.sector_number as sector_id, sf.quantity,
                sf.owner_player_id, sf.owner_clan_id,
                p.name AS owner_player_name,
                c.name AS owner_clan_name,
                c.universe_clan_number AS owner_clan_number
         FROM sector_drones sf
         JOIN sectors s ON sf.sector_id = s.id
         LEFT JOIN players p ON p.id = sf.owner_player_id
         LEFT JOIN clans c ON c.id = sf.owner_clan_id
         WHERE sf.quantity > 0
           AND (sf.owner_player_id = $1
                OR sf.owner_clan_id = (SELECT clan_id FROM players WHERE id = $1))`,
        [playerId],
    );
    return res.rows;
}

/** Total drone count in a sector belonging to the player personally OR
 *  to their clan. Used by the hyperspace-jump homing check, which wants
 *  to confirm the player has *any* friendly drones in the target sector
 *  to home in on. */
export async function getDeployedDronesByOwnerBySector(
    sectorNumber: number,
    playerId: number,
    db: Queryable = pool,
): Promise<number> {
    const res = await db.query<{ quantity: number }>(
        `SELECT COALESCE(SUM(sf.quantity), 0)::int AS quantity FROM sector_drones sf
         JOIN sectors s ON sf.sector_id = s.id
         WHERE s.sector_number = $1
           AND sf.quantity > 0
           AND (
               sf.owner_player_id = $2
               OR sf.owner_clan_id = (SELECT clan_id FROM players WHERE id = $2)
           )`,
        [sectorNumber, playerId],
    );
    return res.rows[0]?.quantity ?? 0;
}

export async function getSectorDronesRowForUpdate(
    sectorDbId: number,
    db: Queryable = pool,
): Promise<
    { quantity: number; owner_player_id: number | null; owner_clan_id: number | null } | undefined
> {
    const res = await db.query<{
        quantity: number;
        owner_player_id: number | null;
        owner_clan_id: number | null;
    }>(
        'SELECT quantity, owner_player_id, owner_clan_id FROM sector_drones WHERE sector_id = $1 FOR UPDATE',
        [sectorDbId],
    );
    return res.rows[0];
}

export async function updateSectorDroneQuantity(
    sectorDbId: number,
    quantity: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query('UPDATE sector_drones SET quantity = $1 WHERE sector_id = $2', [
        quantity,
        sectorDbId,
    ]);
}

/** Update both quantity AND owner in one go. Used when a deploy converts
 *  friendly drones in a sector from personal → clan (or vice versa).
 *  Exactly one of `ownerPlayerId` / `ownerClanId` must be non-null. */
export async function updateSectorDroneOwnerAndQuantity(
    sectorDbId: number,
    ownerPlayerId: number | null,
    ownerClanId: number | null,
    quantity: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `UPDATE sector_drones
         SET owner_player_id = $1, owner_clan_id = $2, quantity = $3
         WHERE sector_id = $4`,
        [ownerPlayerId, ownerClanId, quantity, sectorDbId],
    );
}

/** Insert a new sector_drones row. Exactly one of `ownerPlayerId` /
 *  `ownerClanId` must be non-null. */
export async function insertSectorDrones(
    sectorDbId: number,
    ownerPlayerId: number | null,
    ownerClanId: number | null,
    quantity: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        'INSERT INTO sector_drones (sector_id, owner_player_id, owner_clan_id, quantity) VALUES ($1, $2, $3, $4)',
        [sectorDbId, ownerPlayerId, ownerClanId, quantity],
    );
}

export async function deleteSectorDrones(sectorDbId: number, db: Queryable = pool): Promise<void> {
    await db.query('DELETE FROM sector_drones WHERE sector_id = $1', [sectorDbId]);
}

/** True iff the sector contains drones not owned by the given player or
 *  their clan. Rogue drones (both owner cols NULL) count as enemy. */
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
           AND sf.quantity > 0
           AND NOT (
               COALESCE(sf.owner_player_id = $3, FALSE)
               OR COALESCE(
                   sf.owner_clan_id = (SELECT clan_id FROM players WHERE id = $3),
                   FALSE
               )
           )
         LIMIT 1`,
        [sectorNumber, universeId, selfPlayerId],
    );
    return res.rows.length > 0;
}

/** Sector-drones display info: quantity + structured ownership. */
export async function getSectorDroneDisplayInfo(
    sectorNumber: number,
    universeId: number,
    db: Queryable = pool,
): Promise<{
    quantity: number;
    ownerId: number | null;
    ownership: import('@twnr/shared').OwnershipInfo;
} | null> {
    const res = await db.query<{
        quantity: number;
        owner_player_id: number | null;
        owner_clan_id: number | null;
        owner_player_name: string | null;
        owner_clan_name: string | null;
        owner_clan_number: number | null;
    }>(
        `SELECT sf.quantity, sf.owner_player_id, sf.owner_clan_id,
                p.name AS owner_player_name,
                c.name AS owner_clan_name,
                c.universe_clan_number AS owner_clan_number
         FROM sector_drones sf
         JOIN sectors s ON sf.sector_id = s.id
         LEFT JOIN players p ON sf.owner_player_id = p.id
         LEFT JOIN clans c ON sf.owner_clan_id = c.id
         WHERE s.sector_number = $1 AND s.universe_id = $2 AND sf.quantity > 0`,
        [sectorNumber, universeId],
    );
    const row = res.rows[0];
    if (!row) return null;
    const { ownershipFrom } = await import('../../services/owner-format.js');
    return {
        quantity: row.quantity,
        ownerId: row.owner_player_id,
        ownership: ownershipFrom(row),
    };
}

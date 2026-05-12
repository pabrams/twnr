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

/** Check whether a player has drones deployed in a specific sector. */
export async function getDeployedDronesByOwnerBySector(
    sectorNumber: number,
    playerId: number,
    db: Queryable = pool,
): Promise<number> {
    const res = await db.query<{ quantity: number }>(
        `SELECT sf.quantity FROM sector_drones sf
         JOIN sectors s ON sf.sector_id = s.id
         WHERE s.sector_number = $1 AND sf.owner_player_id = $2 AND sf.quantity > 0`,
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

/** True iff the sector contains drones owned by anyone other than the
 *  given player (including rogue drones, which have owner_player_id NULL). */
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
           AND (sf.owner_player_id IS NULL OR sf.owner_player_id != $3)
           AND sf.quantity > 0
         LIMIT 1`,
        [sectorNumber, universeId, selfPlayerId],
    );
    return res.rows.length > 0;
}

/** Sector-drones display info: quantity + owner-formatted label
 *  (player name, `(#N ClanName)`, or `(Rogue)`). */
export async function getSectorDroneDisplayInfo(
    sectorNumber: number,
    universeId: number,
    db: Queryable = pool,
): Promise<{ quantity: number; ownerId: number | null; ownerName: string } | null> {
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
    const { formatOwner } = await import('../../services/owner-format.js');
    return {
        quantity: row.quantity,
        ownerId: row.owner_player_id,
        ownerName: formatOwner(row),
    };
}

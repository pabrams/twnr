import { pool } from '../index.js';
import type { Queryable } from '../types.js';

export type MineType = 'proximity' | 'seeker';

export type SectorMineRow = {
    sector_id: number;
    mine_type: MineType;
    quantity: number;
    owner_player_id: number | null;
};

/** Fetch the mine row for a sector + type, locked for update (caller in tx). */
export async function getSectorMineForUpdate(
    sectorDbId: number,
    mineType: MineType,
    db: Queryable = pool,
): Promise<SectorMineRow | undefined> {
    const res = await db.query<SectorMineRow>(
        `SELECT sector_id, mine_type, quantity, owner_player_id
         FROM sector_mines
         WHERE sector_id = $1 AND mine_type = $2
         FOR UPDATE`,
        [sectorDbId, mineType],
    );
    return res.rows[0];
}

/** Fetch every mine row in a sector (both types). Read-only. */
export async function getSectorMines(
    sectorDbId: number,
    db: Queryable = pool,
): Promise<SectorMineRow[]> {
    const res = await db.query<SectorMineRow>(
        `SELECT sector_id, mine_type, quantity, owner_player_id
         FROM sector_mines
         WHERE sector_id = $1 AND quantity > 0`,
        [sectorDbId],
    );
    return res.rows;
}

/** Insert or add to existing mine count for the same owner + type. */
export async function upsertSectorMines(
    sectorDbId: number,
    mineType: MineType,
    ownerPlayerId: number,
    addQty: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `INSERT INTO sector_mines (sector_id, mine_type, quantity, owner_player_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (sector_id, mine_type)
         DO UPDATE SET quantity = sector_mines.quantity + $3`,
        [sectorDbId, mineType, addQty, ownerPlayerId],
    );
}

export async function setSectorMineQuantity(
    sectorDbId: number,
    mineType: MineType,
    quantity: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `UPDATE sector_mines SET quantity = $1
         WHERE sector_id = $2 AND mine_type = $3`,
        [quantity, sectorDbId, mineType],
    );
}

export async function deleteSectorMines(
    sectorDbId: number,
    mineType: MineType,
    db: Queryable = pool,
): Promise<void> {
    await db.query(`DELETE FROM sector_mines WHERE sector_id = $1 AND mine_type = $2`, [
        sectorDbId,
        mineType,
    ]);
}

export type DeployedMineByOwnerRow = {
    sector_number: number;
    mine_type: MineType;
    quantity: number;
};

/** All mine deployments owned by a player, joined to sector numbers. */
export async function getDeployedMinesByOwner(
    ownerPlayerId: number,
    db: Queryable = pool,
): Promise<DeployedMineByOwnerRow[]> {
    const res = await db.query<DeployedMineByOwnerRow>(
        `SELECT s.sector_number, sm.mine_type, sm.quantity
         FROM sector_mines sm
         JOIN sectors s ON sm.sector_id = s.id
         WHERE sm.owner_player_id = $1 AND sm.quantity > 0
         ORDER BY s.sector_number, sm.mine_type`,
        [ownerPlayerId],
    );
    return res.rows;
}

export type SeekerAttachmentTargetRow = {
    target_ship_id: number;
    target_ship_type_name: string;
    target_player_name: string | null;
    sector_number: number;
};

/** Seeker mines this player has attached to other ships, with current location. */
export async function getSeekerAttachmentsByOwner(
    ownerPlayerId: number,
    db: Queryable = pool,
): Promise<SeekerAttachmentTargetRow[]> {
    const res = await db.query<SeekerAttachmentTargetRow>(
        `SELECT sa.ship_id AS target_ship_id,
                COALESCE(st.display_name, st.name) AS target_ship_type_name,
                p.name AS target_player_name,
                s.sector_number
         FROM seeker_attachments sa
         JOIN ships sh ON sh.id = sa.ship_id
         JOIN ship_types st ON st.id = sh.ship_type_id
         LEFT JOIN players p ON p.id = sh.owner_id
         LEFT JOIN sectors s ON s.id = sh.sector_id
         WHERE sa.owner_player_id = $1
         ORDER BY s.sector_number`,
        [ownerPlayerId],
    );
    return res.rows;
}

export type SeekerAttachmentRow = {
    ship_id: number;
    owner_player_id: number;
};

/** Find any existing seeker attachment for a ship (for drop-off logic). */
export async function getSeekerAttachmentForUpdate(
    shipId: number,
    db: Queryable = pool,
): Promise<SeekerAttachmentRow | undefined> {
    const res = await db.query<SeekerAttachmentRow>(
        `SELECT ship_id, owner_player_id
         FROM seeker_attachments
         WHERE ship_id = $1
         FOR UPDATE`,
        [shipId],
    );
    return res.rows[0];
}

/** Insert or replace the seeker attachment on a ship. */
export async function upsertSeekerAttachment(
    shipId: number,
    ownerPlayerId: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `INSERT INTO seeker_attachments (ship_id, owner_player_id, attached_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (ship_id) DO UPDATE
         SET owner_player_id = EXCLUDED.owner_player_id, attached_at = NOW()`,
        [shipId, ownerPlayerId],
    );
}

export async function deleteSeekerAttachment(shipId: number, db: Queryable = pool): Promise<void> {
    await db.query('DELETE FROM seeker_attachments WHERE ship_id = $1', [shipId]);
}

export type MineUniverseSettings = {
    proximity_mine_damage: number;
    proximity_detonation_pct: number;
    seeker_attach_pct: number;
    seeker_pickup_detect_pct: number;
    mine_disruptor_min: number;
    mine_disruptor_max: number;
};

export async function getMineUniverseSettings(
    universeId: number,
    db: Queryable = pool,
): Promise<MineUniverseSettings> {
    const res = await db.query<MineUniverseSettings>(
        `SELECT proximity_mine_damage, proximity_detonation_pct,
                seeker_attach_pct, seeker_pickup_detect_pct,
                mine_disruptor_min, mine_disruptor_max
         FROM universe_settings WHERE universe_id = $1`,
        [universeId],
    );
    return (
        res.rows[0] ?? {
            proximity_mine_damage: 100,
            proximity_detonation_pct: 50,
            seeker_attach_pct: 25,
            seeker_pickup_detect_pct: 80,
            mine_disruptor_min: 3,
            mine_disruptor_max: 5,
        }
    );
}

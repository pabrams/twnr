import { pool } from '../index.js';
import type { Queryable } from '../types.js';

export type MineType = 'proximity' | 'seeker';

export type SectorMineRow = {
    sector_id: number;
    mine_type: MineType;
    quantity: number;
    owner_player_id: number | null;
    owner_clan_id: number | null;
};

/** Fetch the mine row for a sector + type, locked for update (caller in tx). */
export async function getSectorMineForUpdate(
    sectorDbId: number,
    mineType: MineType,
    db: Queryable = pool,
): Promise<SectorMineRow | undefined> {
    const res = await db.query<SectorMineRow>(
        `SELECT sector_id, mine_type, quantity, owner_player_id, owner_clan_id
         FROM sector_mines
         WHERE sector_id = $1 AND mine_type = $2
         FOR UPDATE`,
        [sectorDbId, mineType],
    );
    return res.rows[0];
}

/** Fetch the mine row for a sector. */
export async function getSectorMine(
    sectorDbId: number,
    mineType: MineType,
    db: Queryable = pool,
): Promise<SectorMineRow | undefined> {
    const res = await db.query<SectorMineRow>(
        `SELECT sector_id, mine_type, quantity, owner_player_id, owner_clan_id
         FROM sector_mines
         WHERE sector_id = $1 AND mine_type = $2`,
        [sectorDbId, mineType],
    );
    return res.rows[0];
}

export type SectorMineDisplayRow = SectorMineRow & {
    owner_player_name: string | null;
    owner_clan_name: string | null;
    owner_clan_number: number | null;
};

/** Fetch every mine row in a sector (both types) with owner JOIN cols for
 *  display. Read-only. */
export async function getSectorMines(
    sectorDbId: number,
    db: Queryable = pool,
): Promise<SectorMineDisplayRow[]> {
    const res = await db.query<SectorMineDisplayRow>(
        `SELECT sm.sector_id, sm.mine_type, sm.quantity,
                sm.owner_player_id, sm.owner_clan_id,
                p.name AS owner_player_name,
                c.name AS owner_clan_name,
                c.universe_clan_number AS owner_clan_number
         FROM sector_mines sm
         LEFT JOIN players p ON p.id = sm.owner_player_id
         LEFT JOIN clans c ON c.id = sm.owner_clan_id
         WHERE sm.sector_id = $1 AND sm.quantity > 0`,
        [sectorDbId],
    );
    return res.rows;
}

/** Insert or add to existing mine count. Exactly one of `ownerPlayerId` /
 *  `ownerClanId` must be non-null. On conflict, the deploying player's
 *  ownership wins — caller is expected to have verified that any
 *  pre-existing row in this (sector, type) is friendly (personal-mine
 *  deployer is the owner, or clan-mine deployer's clan is the owner),
 *  which makes an ownership flip from personal→clan (or vice versa) a
 *  valid redesignation, not a hostile takeover. */
export async function upsertSectorMines(
    sectorDbId: number,
    mineType: MineType,
    ownerPlayerId: number | null,
    ownerClanId: number | null,
    addQty: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `INSERT INTO sector_mines (sector_id, mine_type, quantity, owner_player_id, owner_clan_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (sector_id, mine_type)
         DO UPDATE SET
             quantity = sector_mines.quantity + $3,
             owner_player_id = EXCLUDED.owner_player_id,
             owner_clan_id = EXCLUDED.owner_clan_id`,
        [sectorDbId, mineType, addQty, ownerPlayerId, ownerClanId],
    );
}

/** Set the mine row to an exact quantity + ownership (insert if absent,
 *  delete if quantity <= 0). Used by `serveDeployMine` after computing
 *  the target total. Exactly one of `ownerPlayerId` / `ownerClanId` must
 *  be non-null when quantity > 0. */
export async function setSectorMineTo(
    sectorDbId: number,
    mineType: MineType,
    ownerPlayerId: number | null,
    ownerClanId: number | null,
    quantity: number,
    db: Queryable = pool,
): Promise<void> {
    if (quantity <= 0) {
        await deleteSectorMines(sectorDbId, mineType, db);
        return;
    }
    await db.query(
        `INSERT INTO sector_mines (sector_id, mine_type, quantity, owner_player_id, owner_clan_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (sector_id, mine_type)
         DO UPDATE SET
             quantity = EXCLUDED.quantity,
             owner_player_id = EXCLUDED.owner_player_id,
             owner_clan_id = EXCLUDED.owner_clan_id`,
        [sectorDbId, mineType, quantity, ownerPlayerId, ownerClanId],
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
    owner_player_id: number | null;
    owner_clan_id: number | null;
    owner_player_name: string | null;
    owner_clan_name: string | null;
    owner_clan_number: number | null;
};

/** All mine deployments accessible to playerId (player's and clan's). */
export async function getDeployedMinesByOwner(
    playerId: number,
    db: Queryable = pool,
): Promise<DeployedMineByOwnerRow[]> {
    const res = await db.query<DeployedMineByOwnerRow>(
        `SELECT s.sector_number, sm.mine_type, sm.quantity,
                sm.owner_player_id, sm.owner_clan_id,
                p.name AS owner_player_name,
                c.name AS owner_clan_name,
                c.universe_clan_number AS owner_clan_number
         FROM sector_mines sm
         JOIN sectors s ON sm.sector_id = s.id
         LEFT JOIN players p ON p.id = sm.owner_player_id
         LEFT JOIN clans c ON c.id = sm.owner_clan_id
         WHERE sm.quantity > 0
           AND (sm.owner_player_id = $1
                OR sm.owner_clan_id = (SELECT clan_id FROM players WHERE id = $1))
         ORDER BY s.sector_number, sm.mine_type`,
        [playerId],
    );
    return res.rows;
}

export type SeekerAttachmentTargetRow = {
    target_ship_id: number;
    target_ship_type_name: string;
    target_player_name: string | null;
    sector_number: number;
};

/** Seeker mines attached to other ships that belong to the given player
 *  personally OR to their clan, with current target location. */
export async function getSeekerAttachmentsByOwner(
    ownerPlayerId: number,
    db: Queryable = pool,
): Promise<SeekerAttachmentTargetRow[]> {
    const res = await db.query<SeekerAttachmentTargetRow>(
        `SELECT sa.ship_id AS target_ship_id,
                COALESCE(st.display_name, st.slug) AS target_ship_type_name,
                p.name AS target_player_name,
                s.sector_number
         FROM seeker_attachments sa
         JOIN ships sh ON sh.id = sa.ship_id
         JOIN universe_ship_types st ON st.universe_id = sh.universe_id AND st.slug = sh.ship_type_slug
         LEFT JOIN players p ON p.id = sh.owner_player_id
         LEFT JOIN sectors s ON s.id = sh.sector_id
         WHERE sa.owner_player_id = $1
            OR sa.owner_clan_id = (SELECT clan_id FROM players WHERE id = $1)
         ORDER BY s.sector_number`,
        [ownerPlayerId],
    );
    return res.rows;
}

export type SeekerAttachmentRow = {
    ship_id: number;
    owner_player_id: number | null;
    owner_clan_id: number | null;
};

/** Find any existing seeker attachment for a ship (for drop-off logic). */
export async function getSeekerAttachmentForUpdate(
    shipId: number,
    db: Queryable = pool,
): Promise<SeekerAttachmentRow | undefined> {
    const res = await db.query<SeekerAttachmentRow>(
        `SELECT ship_id, owner_player_id, owner_clan_id
         FROM seeker_attachments
         WHERE ship_id = $1
         FOR UPDATE`,
        [shipId],
    );
    return res.rows[0];
}

/** Insert or replace the seeker attachment on a ship. Exactly one of
 *  `ownerPlayerId` / `ownerClanId` must be non-null (XOR enforced by the
 *  table's check constraint). */
export async function upsertSeekerAttachment(
    shipId: number,
    ownerPlayerId: number | null,
    ownerClanId: number | null,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `INSERT INTO seeker_attachments (ship_id, owner_player_id, owner_clan_id, attached_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (ship_id) DO UPDATE
         SET owner_player_id = EXCLUDED.owner_player_id,
             owner_clan_id = EXCLUDED.owner_clan_id,
             attached_at = NOW()`,
        [shipId, ownerPlayerId, ownerClanId],
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

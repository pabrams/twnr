import { pool } from '../index.js';
import type { Queryable } from '../types.js';

export type SectorBeaconRow = {
    sector_id: number;
    message: string;
    owner_player_id: number | null;
    owner_clan_id: number | null;
    owner_player_name: string | null;
    owner_clan_name: string | null;
    owner_clan_number: number | null;
};

export async function getSectorBeacon(
    sectorDbId: number,
    db: Queryable = pool,
): Promise<SectorBeaconRow | undefined> {
    const res = await db.query<SectorBeaconRow>(
        `SELECT sb.sector_id, sb.message, sb.owner_player_id, sb.owner_clan_id,
                p.name AS owner_player_name,
                c.name AS owner_clan_name,
                c.universe_clan_number AS owner_clan_number
         FROM sector_beacons sb
         LEFT JOIN players p ON p.id = sb.owner_player_id
         LEFT JOIN clans c ON c.id = sb.owner_clan_id
         WHERE sb.sector_id = $1`,
        [sectorDbId],
    );
    return res.rows[0];
}

export async function getSectorBeaconForUpdate(
    sectorDbId: number,
    db: Queryable = pool,
): Promise<{ sector_id: number; message: string } | undefined> {
    const res = await db.query<{ sector_id: number; message: string }>(
        'SELECT sector_id, message FROM sector_beacons WHERE sector_id = $1 FOR UPDATE',
        [sectorDbId],
    );
    return res.rows[0];
}

export async function insertSectorBeacon(
    sectorDbId: number,
    message: string,
    ownerPlayerId: number | null,
    ownerClanId: number | null,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `INSERT INTO sector_beacons (sector_id, message, owner_player_id, owner_clan_id)
         VALUES ($1, $2, $3, $4)`,
        [sectorDbId, message, ownerPlayerId, ownerClanId],
    );
}

export async function deleteSectorBeacon(sectorDbId: number, db: Queryable = pool): Promise<void> {
    await db.query('DELETE FROM sector_beacons WHERE sector_id = $1', [sectorDbId]);
}

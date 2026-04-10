import { pool } from '../index.js';

type Queryable = { query: (text: string, params?: any[]) => Promise<any> };

/** Subselect for the player's ship — used in WHERE clauses. */
const SHIP_ID_SUBSELECT = '(SELECT ship_id FROM players WHERE id = $1)';

export async function getShipDrones(
    playerId: number,
    db: Queryable = pool,
): Promise<number | undefined> {
    const res = await db.query(`SELECT drones FROM ships WHERE id = ${SHIP_ID_SUBSELECT}`, [
        playerId,
    ]);
    return res.rows[0]?.drones;
}

export async function getShipDronesForUpdate(
    playerId: number,
    db: Queryable = pool,
): Promise<number | undefined> {
    const res = await db.query(
        `SELECT drones FROM ships WHERE id = ${SHIP_ID_SUBSELECT} FOR UPDATE`,
        [playerId],
    );
    return res.rows[0]?.drones;
}

export async function setShipDrones(
    playerId: number,
    drones: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `UPDATE ships SET drones = $1 WHERE id = ${SHIP_ID_SUBSELECT.replace('$1', '$2')}`,
        [drones, playerId],
    );
}

export async function moveShipToSector(
    playerId: number,
    sectorId: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `UPDATE ships SET sector_id = $1 WHERE id = ${SHIP_ID_SUBSELECT.replace('$1', '$2')}`,
        [sectorId, playerId],
    );
}

export async function getTurnsPerWarp(playerId: number): Promise<number> {
    const res = await pool.query(
        `SELECT s.turns_per_warp FROM ships s WHERE s.id = ${SHIP_ID_SUBSELECT}`,
        [playerId],
    );
    return res.rows[0]?.turns_per_warp ?? 1;
}

export async function getShipFuel(playerId: number): Promise<number | undefined> {
    const res = await pool.query(`SELECT fuel FROM ships WHERE id = ${SHIP_ID_SUBSELECT}`, [
        playerId,
    ]);
    return res.rows[0]?.fuel;
}

import { pool } from '../index.js';
import type { Queryable } from '../types.js';

/** Subselect for the player's ship — used in WHERE clauses. */
const SHIP_ID_SUBSELECT = '(SELECT ship_id FROM players WHERE id = $1)';

export async function getShipDrones(
    playerId: number,
    db: Queryable = pool,
): Promise<number | undefined> {
    const res = await db.query<{ drones: number }>(
        `SELECT drones FROM ships WHERE id = ${SHIP_ID_SUBSELECT}`,
        [playerId],
    );
    return res.rows[0]?.drones;
}

export async function getShipDronesForUpdate(
    playerId: number,
    db: Queryable = pool,
): Promise<number | undefined> {
    const res = await db.query<{ drones: number }>(
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

/** Combat: fetch drones + shields for a player's ship with row lock. */
export async function getShipDronesAndShieldsForUpdate(
    playerId: number,
    db: Queryable = pool,
): Promise<{ drones: number; shields: number } | undefined> {
    const res = await db.query<{ drones: number; shields: number }>(
        `SELECT drones, shields FROM ships WHERE id = ${SHIP_ID_SUBSELECT} FOR UPDATE`,
        [playerId],
    );
    return res.rows[0];
}

/** Combat: update both drones and shields on a player's ship. */
export async function setShipDronesAndShields(
    playerId: number,
    drones: number,
    shields: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `UPDATE ships SET drones = $1, shields = $2 WHERE id = (SELECT ship_id FROM players WHERE id = $3)`,
        [drones, shields, playerId],
    );
}

/** Combat: remove a ship record when its owner's ship is destroyed. */
export async function deleteShipByOwner(ownerId: number, db: Queryable = pool): Promise<void> {
    await db.query('DELETE FROM ships WHERE owner_id = $1', [ownerId]);
}

/** Combat: mark a player as ship-less and stamp destruction time. */
export async function markPlayerShipDestroyed(
    playerId: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query('UPDATE players SET ship_id = NULL, ship_destroyed_date = NOW() WHERE id = $1', [
        playerId,
    ]);
}

/** Cargo: fetch the four cargo-commodity quantities on a player's ship. */
export async function getShipCargo(
    playerId: number,
    db: Queryable = pool,
): Promise<{ fuel: number; organics: number; equipment: number; colonists: number } | undefined> {
    const res = await db.query<{
        fuel: number;
        organics: number;
        equipment: number;
        colonists: number;
    }>(
        'SELECT s.fuel, s.organics, s.equipment, s.colonists FROM players p JOIN ships s ON p.ship_id = s.id WHERE p.id = $1',
        [playerId],
    );
    return res.rows[0];
}

/** Cargo: empty all four cargo commodities on a player's ship (jettison). */
export async function zeroShipCargo(playerId: number, db: Queryable = pool): Promise<void> {
    await db.query(
        `UPDATE ships SET fuel = 0, organics = 0, equipment = 0, colonists = 0 WHERE id = ${SHIP_ID_SUBSELECT}`,
        [playerId],
    );
}

export type ShipInfoRow = {
    ship_name: string;
    ship_id: number;
    ship_type_id: number;
    drones: number;
    shields: number;
    holds: number;
    turns_per_warp: number;
    has_density_scanner: boolean;
    fuel: number;
    organics: number;
    equipment: number;
    colonists: number;
    turns: number;
    credits: number;
    max_drones: number;
    max_shields: number;
    max_holds: number;
};

/** Ship info: all stats needed by the "i" command / ShipInfo panel. */
export async function getShipInfo(
    playerId: number,
    db: Queryable = pool,
): Promise<ShipInfoRow | undefined> {
    const res = await db.query<ShipInfoRow>(
        `SELECT st.name AS ship_name, s.id AS ship_id, s.ship_type_id,
                s.drones, s.shields, s.holds,
                s.turns_per_warp, s.has_density_scanner,
                s.fuel, s.organics, s.equipment, s.colonists,
                p.turns, p.credits,
                st.max_drones, st.max_shields, st.max_holds
         FROM players p
         JOIN ships s ON p.ship_id = s.id
         JOIN ship_types st ON s.ship_type_id = st.id
         WHERE p.id = $1`,
        [playerId],
    );
    return res.rows[0];
}

/** Hyperwarp: fetch ship id, turns/warp, and whether hyperspace 1 or 2 is equipped. */
export type HyperspaceInfoRow = {
    ship_id: number;
    turns_per_warp: number;
    has_hyperspace_1: number;
    has_hyperspace_2: number;
};
export async function getShipHyperspaceInfo(
    playerId: number,
    db: Queryable = pool,
): Promise<HyperspaceInfoRow | undefined> {
    const res = await db.query<HyperspaceInfoRow>(
        `SELECT s.id as ship_id, s.turns_per_warp,
                COALESCE(sh1.quantity, 0) as has_hyperspace_1,
                COALESCE(sh2.quantity, 0) as has_hyperspace_2
         FROM ships s
         JOIN players p ON p.ship_id = s.id
         LEFT JOIN ship_hardware sh1 ON sh1.ship_id = s.id
           AND sh1.hardware_item_id = (SELECT id FROM hardware_item WHERE name = 'hyperspace_1')
         LEFT JOIN ship_hardware sh2 ON sh2.ship_id = s.id
           AND sh2.hardware_item_id = (SELECT id FROM hardware_item WHERE name = 'hyperspace_2')
         WHERE p.id = $1`,
        [playerId],
    );
    return res.rows[0];
}

/** Hyperwarp: deduct fuel and move ship to a new sector in one UPDATE. */
export async function deductShipFuelAndMoveShip(
    shipId: number,
    fuelCost: number,
    sectorId: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query('UPDATE ships SET fuel = fuel - $1, sector_id = $2 WHERE id = $3', [
        fuelCost,
        sectorId,
        shipId,
    ]);
}

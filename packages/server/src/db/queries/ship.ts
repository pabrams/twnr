import { pool } from '../index.js';
import type { Queryable } from '../types.js';

/** Subselect for the player's ship — used in WHERE clauses. */
const SHIP_ID_SUBSELECT = '(SELECT ship_id FROM players WHERE id = $1)';

export async function getShipTurnsPerWarp(
    playerId: number,
    db: Queryable = pool,
): Promise<number> {
    const res = await db.query<{ turns_per_warp: number }>(
        `SELECT turns_per_warp FROM ships WHERE id = ${SHIP_ID_SUBSELECT}`,
        [playerId],
    );
    return res.rows[0]?.turns_per_warp ?? 1;
}

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

/** Class-0 upgrade: credits + current ship stats + all maxes, locked. */
export type ShipUpgradeRow = {
    credits: number;
    drones: number;
    shields: number;
    holds: number;
    max_drones: number;
    max_shields: number;
    max_holds: number;
};
export async function getShipUpgradeInfoForUpdate(
    playerId: number,
    db: Queryable = pool,
): Promise<ShipUpgradeRow | undefined> {
    const res = await db.query<ShipUpgradeRow>(
        `SELECT p.credits, s.drones, s.shields, s.holds,
                st.max_drones, st.max_shields, st.max_holds
         FROM players p
         JOIN ships s ON p.ship_id = s.id
         JOIN ship_types st ON s.ship_type_id = st.id
         WHERE p.id = $1 FOR UPDATE`,
        [playerId],
    );
    return res.rows[0];
}

/** Class-0 upgrade: add N drones to a player's ship. */
export async function incrementShipDrones(
    playerId: number,
    qty: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `UPDATE ships SET drones = drones + $1 WHERE id = ${SHIP_ID_SUBSELECT.replace('$1', '$2')}`,
        [qty, playerId],
    );
}

/** Class-0 upgrade: add N shields to a player's ship. */
export async function incrementShipShields(
    playerId: number,
    qty: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `UPDATE ships SET shields = shields + $1 WHERE id = ${SHIP_ID_SUBSELECT.replace('$1', '$2')}`,
        [qty, playerId],
    );
}

/** Class-0 upgrade: add N holds to a player's ship. */
export async function incrementShipHolds(
    playerId: number,
    qty: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `UPDATE ships SET holds = holds + $1 WHERE id = ${SHIP_ID_SUBSELECT.replace('$1', '$2')}`,
        [qty, playerId],
    );
}

/** Deploy-drones info: current drones + ship-type max + ship-type name. */
export type ShipDronesInfoRow = {
    drones: number;
    ship_name: string;
    max_drones: number;
};
export async function getShipDronesAndMaxInfo(
    playerId: number,
    db: Queryable = pool,
): Promise<ShipDronesInfoRow | undefined> {
    const res = await db.query<ShipDronesInfoRow>(
        `SELECT s.drones, st.name as ship_name, st.max_drones
         FROM ships s JOIN ship_types st ON s.ship_type_id = st.id
         WHERE s.id = ${SHIP_ID_SUBSELECT}`,
        [playerId],
    );
    return res.rows[0];
}

/** Deploy-drones: current drones + ship-type max, locked for update. */
export async function getShipDronesAndMaxForUpdate(
    playerId: number,
    db: Queryable = pool,
): Promise<{ drones: number; max_drones: number } | undefined> {
    const res = await db.query<{ drones: number; max_drones: number }>(
        `SELECT s.drones, st.max_drones
         FROM ships s JOIN ship_types st ON s.ship_type_id = st.id
         WHERE s.id = ${SHIP_ID_SUBSELECT} FOR UPDATE`,
        [playerId],
    );
    return res.rows[0];
}

/** Full ship_types row with pricing — for shipyards / trade-in logic. */
export type ShipTypeRow = {
    id: number;
    name: string;
    starting_holds: number;
    max_holds: number;
    max_drones: number;
    max_shields: number;
    cost_drive: number;
    cost_computer: number;
    cost_hull: number;
    hold_cost: number;
    turns_per_warp: number;
};

/** Look up a ship_types row by its name (e.g. 'Merchant Cruiser'). */
export async function getShipTypeByName(
    name: string,
    db: Queryable = pool,
): Promise<ShipTypeRow | undefined> {
    const res = await db.query<ShipTypeRow>(
        `SELECT id, name, starting_holds, max_holds, max_drones, max_shields,
                cost_drive, cost_computer, cost_hull, hold_cost, turns_per_warp
         FROM ship_types WHERE name = $1`,
        [name],
    );
    return res.rows[0];
}

/** Ship-exchange trade-in view: credits, current sector, current ship pricing + ship_id, locked. */
export type PlayerShipTradeInfoRow = {
    credits: number;
    current_sector_id: number;
    ship_name: string;
    current_cost_drive: number;
    current_cost_computer: number;
    current_cost_hull: number;
    current_hold_cost: number;
    current_starting_holds: number;
    ship_id: number;
};
export async function getPlayerShipTradeInfoForUpdate(
    playerId: number,
    db: Queryable = pool,
): Promise<PlayerShipTradeInfoRow | undefined> {
    const res = await db.query<PlayerShipTradeInfoRow>(
        `SELECT p.credits, p.current_sector_id,
                st.name AS ship_name,
                st.cost_drive AS current_cost_drive, st.cost_computer AS current_cost_computer,
                st.cost_hull AS current_cost_hull, st.hold_cost AS current_hold_cost,
                st.starting_holds AS current_starting_holds,
                s.id AS ship_id
         FROM players p
         JOIN ships s ON p.ship_id = s.id
         JOIN ship_types st ON s.ship_type_id = st.id
         WHERE p.id = $1 FOR UPDATE`,
        [playerId],
    );
    return res.rows[0];
}

/** Buy-new-ship view: just credits + sector + current ship_id + name, locked. */
export type PlayerShipBuyInfoRow = {
    credits: number;
    current_sector_id: number;
    ship_id: number;
    ship_name: string;
};
export async function getPlayerShipBuyInfoForUpdate(
    playerId: number,
    db: Queryable = pool,
): Promise<PlayerShipBuyInfoRow | undefined> {
    const res = await db.query<PlayerShipBuyInfoRow>(
        `SELECT p.credits, p.current_sector_id, sh.id AS ship_id,
                st.name AS ship_name
         FROM players p
         JOIN ships sh ON p.ship_id = sh.id
         JOIN ship_types st ON sh.ship_type_id = st.id
         WHERE p.id = $1 FOR UPDATE`,
        [playerId],
    );
    return res.rows[0];
}

/** Insert a new empty ship; returns its id. */
export async function insertEmptyShip(
    ownerId: number,
    shipTypeId: number,
    sectorId: number,
    holds: number,
    turnsPerWarp: number,
    db: Queryable = pool,
): Promise<number> {
    const res = await db.query<{ id: number }>(
        `INSERT INTO ships (owner_id, ship_type_id, sector_id, drones, shields, holds, turns_per_warp, fuel, organics, equipment, colonists)
         VALUES ($1, $2, $3, 0, 0, $4, $5, 0, 0, 0, 0)
         RETURNING id`,
        [ownerId, shipTypeId, sectorId, holds, turnsPerWarp],
    );
    return res.rows[0].id;
}

/** Atomically point a player at a new ship and deduct credits. */
export async function setPlayerShipAndDeductCredits(
    playerId: number,
    shipId: number,
    cost: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query('UPDATE players SET ship_id = $1, credits = credits - $2 WHERE id = $3', [
        shipId,
        cost,
        playerId,
    ]);
}

/** Delete a ship by its row id (used on trade-in). */
export async function deleteShipById(shipId: number, db: Queryable = pool): Promise<void> {
    await db.query('DELETE FROM ships WHERE id = $1', [shipId]);
}

/** Ship cargo + holds capacity, locked for update (colonist pickup flow). */
export async function getShipHoldsAndCargoForUpdate(
    playerId: number,
    db: Queryable = pool,
): Promise<
    | { holds: number; fuel: number; organics: number; equipment: number; colonists: number }
    | undefined
> {
    const res = await db.query<{
        holds: number;
        fuel: number;
        organics: number;
        equipment: number;
        colonists: number;
    }>(
        `SELECT s.holds, s.fuel, s.organics, s.equipment, s.colonists
         FROM ships s WHERE s.id = ${SHIP_ID_SUBSELECT} FOR UPDATE`,
        [playerId],
    );
    return res.rows[0];
}

/** Fetch the colonists count on a player's ship, locked for update. */
export async function getShipColonistsForUpdate(
    playerId: number,
    db: Queryable = pool,
): Promise<number | undefined> {
    const res = await db.query<{ colonists: number }>(
        `SELECT colonists FROM ships WHERE id = ${SHIP_ID_SUBSELECT} FOR UPDATE`,
        [playerId],
    );
    return res.rows[0]?.colonists;
}

/** Fetch the current colonists count on a player's ship. */
export async function getShipColonists(
    playerId: number,
    db: Queryable = pool,
): Promise<number | undefined> {
    const res = await db.query<{ colonists: number }>(
        `SELECT colonists FROM ships WHERE id = ${SHIP_ID_SUBSELECT}`,
        [playerId],
    );
    return res.rows[0]?.colonists;
}

/** Apply a +/- delta to the colonists count on a player's ship. */
export async function incrementShipColonists(
    playerId: number,
    delta: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `UPDATE ships SET colonists = colonists + $1 WHERE id = ${SHIP_ID_SUBSELECT.replace('$1', '$2')}`,
        [delta, playerId],
    );
}

/** Cargo quantities + credits + holds capacity for a player. */
export type CargoWithCreditsRow = {
    fuel: number;
    organics: number;
    equipment: number;
    colonists: number;
    cargo_limit: number;
    credits: number;
};
export async function getShipCargoWithCredits(
    playerId: number,
    db: Queryable = pool,
): Promise<CargoWithCreditsRow | undefined> {
    const res = await db.query<CargoWithCreditsRow>(
        `SELECT s.fuel, s.organics, s.equipment, s.colonists, s.holds as cargo_limit, pl.credits
         FROM players pl JOIN ships s ON pl.ship_id = s.id WHERE pl.id = $1`,
        [playerId],
    );
    return res.rows[0];
}

/** Same as getShipCargoWithCredits but locks both player + ship rows for trade. */
export async function getShipCargoWithCreditsForUpdate(
    playerId: number,
    db: Queryable = pool,
): Promise<CargoWithCreditsRow | undefined> {
    const res = await db.query<CargoWithCreditsRow>(
        `SELECT s.fuel, s.organics, s.equipment, s.colonists, s.holds as cargo_limit, p.credits
         FROM players p JOIN ships s ON p.ship_id = s.id
         WHERE p.id = $1 FOR UPDATE OF s, p`,
        [playerId],
    );
    return res.rows[0];
}

/** Whitelist of ship cargo columns — blocks SQL injection via dynamic column. */
const SHIP_COMMODITY_COLUMN: Record<'fuel' | 'organics' | 'equipment' | 'colonists', string> = {
    fuel: 'fuel',
    organics: 'organics',
    equipment: 'equipment',
    colonists: 'colonists',
};
export type ShipCommodity = keyof typeof SHIP_COMMODITY_COLUMN;

/** Apply a +/- delta to a commodity on a player's ship. */
export async function incrementShipCommodity(
    playerId: number,
    commodity: ShipCommodity,
    delta: number,
    db: Queryable = pool,
): Promise<void> {
    const col = SHIP_COMMODITY_COLUMN[commodity];
    await db.query(
        `UPDATE ships SET ${col} = ${col} + $1 WHERE id = (SELECT ship_id FROM players WHERE id = $2)`,
        [delta, playerId],
    );
}

/** Full player-ship + ship-type row (wide) for game-state snapshotting. */
export async function getPlayerShipFull(
    playerId: number,
    db: Queryable = pool,
): Promise<Record<string, unknown> | null> {
    const res = await db.query<Record<string, unknown>>(
        `SELECT s.id, s.drones, s.shields, s.holds,
                s.turns_per_warp, s.has_density_scanner,
                s.fuel, s.organics, s.equipment, s.colonists,
                s.sector_id, s.ship_type_id,
                st.name as ship_name, st.max_drones, st.max_shields, st.max_holds,
                st.starting_holds, st.turns_per_warp as type_turns_per_warp,
                st.cost_drive, st.cost_computer, st.cost_hull, st.hold_cost,
                st.odds_offensive, st.odds_defensive, st.speed,
                st.max_drone_attack, st.transporter_range,
                st.has_tractor, st.has_pod, st.can_land, st.has_interdictor,
                st.sort_order
         FROM ships s
         JOIN ship_types st ON s.ship_type_id = st.id
         WHERE s.id = ${SHIP_ID_SUBSELECT}`,
        [playerId],
    );
    return res.rows[0] ?? null;
}

/** Partial ship_types info needed for respawning a player on a starting ship. */
export type StartingShipTypeRow = {
    id: number;
    starting_holds: number;
    turns_per_warp: number;
};
export async function getStartingShipTypeByName(
    name: string,
    db: Queryable = pool,
): Promise<StartingShipTypeRow | undefined> {
    const res = await db.query<StartingShipTypeRow>(
        'SELECT id, starting_holds, turns_per_warp FROM ship_types WHERE name = $1',
        [name],
    );
    return res.rows[0];
}

/** Create a starting ship for a respawning player; returns its id. */
export async function insertStartingShip(
    ownerId: number,
    shipTypeId: number,
    sectorId: number,
    drones: number,
    shields: number,
    holds: number,
    turnsPerWarp: number,
    db: Queryable = pool,
): Promise<number> {
    const res = await db.query<{ id: number }>(
        `INSERT INTO ships (owner_id, ship_type_id, sector_id, drones, shields, holds, turns_per_warp)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [ownerId, shipTypeId, sectorId, drones, shields, holds, turnsPerWarp],
    );
    return res.rows[0].id;
}

/** Abandoned (owner-less) ships present in a sector — for sector display. */
export async function getAbandonedShipsInSector(
    sectorNumber: number,
    universeId: number,
    db: Queryable = pool,
): Promise<{ id: number; typeName: string; ownerName: string }[]> {
    const res = await db.query<{ id: number; type_name: string; owner_name: string }>(
        `SELECT sh.id, st.name AS type_name, COALESCE(p.name, 'Abandoned') AS owner_name
         FROM ships sh
         JOIN ship_types st ON sh.ship_type_id = st.id
         JOIN sectors s ON sh.sector_id = s.id
         LEFT JOIN players p ON sh.owner_id = p.id
         WHERE s.sector_number = $1 AND s.universe_id = $2
           AND NOT EXISTS (SELECT 1 FROM players p2 WHERE p2.ship_id = sh.id)`,
        [sectorNumber, universeId],
    );
    return res.rows.map((r) => ({
        id: r.id,
        typeName: r.type_name,
        ownerName: r.owner_name,
    }));
}

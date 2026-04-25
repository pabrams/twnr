import { pool } from '../index.js';
import type { Queryable, HardwarePriceRow } from '../types.js';

/** Whitelist of commodity column names — blocks SQL injection via dynamic column. */
const COMMODITY_COLUMN: Record<'fuel' | 'organics' | 'equipment', string> = {
    fuel: 'fuel',
    organics: 'organics',
    equipment: 'equipment',
};
export type Commodity = keyof typeof COMMODITY_COLUMN;

/** Fetch the port class at a given sector, or undefined if no port there. */
export async function getPortClassAtSector(
    sectorNumber: number,
    universeId: number,
    db: Queryable = pool,
): Promise<number | undefined> {
    const res = await db.query<{ class: number }>(
        `SELECT p.class FROM ports p JOIN sectors s ON p.sector_id = s.id
         WHERE s.sector_number = $1 AND s.universe_id = $2`,
        [sectorNumber, universeId],
    );
    return res.rows[0]?.class;
}

/** Full port row keyed by sector number (returns undefined if no port). */
export type PortFullRow = {
    sector_id: number;
    class: number;
    fuel: number;
    fuel_max: number;
    fuel_price: number;
    organics: number;
    org_max: number;
    org_price: number;
    equipment: number;
    equ_max: number;
    equ_price: number;
};
export async function getPortAtSector(
    sectorNumber: number,
    universeId: number,
    db: Queryable = pool,
): Promise<PortFullRow | undefined> {
    const res = await db.query<PortFullRow>(
        `SELECT s.sector_number as sector_id, p.class, p.fuel, p.fuel_max, p.fuel_price,
                p.organics, p.org_max, p.org_price, p.equipment, p.equ_max, p.equ_price
         FROM ports p JOIN sectors s ON p.sector_id = s.id
         WHERE s.sector_number = $1 AND s.universe_id = $2`,
        [sectorNumber, universeId],
    );
    return res.rows[0];
}

/** Current tradable quantities at a port (fuel/organics/equipment only). */
export type PortInventoryRow = {
    fuel: number;
    organics: number;
    equipment: number;
};
export async function getPortInventoryAtSector(
    sectorNumber: number,
    universeId: number,
    db: Queryable = pool,
): Promise<PortInventoryRow | undefined> {
    const res = await db.query<PortInventoryRow>(
        `SELECT p.fuel, p.organics, p.equipment FROM ports p JOIN sectors s ON p.sector_id = s.id
         WHERE s.sector_number = $1 AND s.universe_id = $2`,
        [sectorNumber, universeId],
    );
    return res.rows[0];
}

/** Port id + class + inventory + prices, locked for trade execution. */
export type PortTradeRow = {
    port_id: number;
    class: number;
    fuel: number;
    fuel_price: number;
    organics: number;
    org_price: number;
    equipment: number;
    equ_price: number;
};
export async function getPortTradeInfoForUpdate(
    sectorNumber: number,
    universeId: number,
    db: Queryable = pool,
): Promise<PortTradeRow | undefined> {
    const res = await db.query<PortTradeRow>(
        `SELECT p.id as port_id, p.class, p.fuel, p.fuel_price,
                p.organics, p.org_price, p.equipment, p.equ_price
         FROM ports p JOIN sectors s ON p.sector_id = s.id
         WHERE s.sector_number = $1 AND s.universe_id = $2 FOR UPDATE OF p`,
        [sectorNumber, universeId],
    );
    return res.rows[0];
}

/** Decrement a port's inventory for a commodity by N (used by buy + sell, since
 *  selling also removes from port's "demand" counter). */
export async function decrementPortCommodity(
    portId: number,
    commodity: Commodity,
    qty: number,
    db: Queryable = pool,
): Promise<void> {
    const col = COMMODITY_COLUMN[commodity];
    await db.query(`UPDATE ports SET ${col} = ${col} - $1 WHERE id = $2`, [qty, portId]);
}

/** Port admin row with sector_number instead of sector_id (for listing). */
export type PortAdminListRow = {
    sector_id: number;
    class: number;
    fuel: number;
    fuel_price: number;
    organics: number;
    org_price: number;
    equipment: number;
    equ_price: number;
};
export async function listPortsInUniverse(
    universeId: number,
    db: Queryable = pool,
): Promise<PortAdminListRow[]> {
    const res = await db.query<PortAdminListRow>(
        `SELECT s.sector_number as sector_id, p.class, p.fuel, p.fuel_price,
                p.organics, p.org_price, p.equipment, p.equ_price
         FROM ports p
         JOIN sectors s ON p.sector_id = s.id
         WHERE s.universe_id = $1 ORDER BY s.sector_number ASC`,
        [universeId],
    );
    return res.rows;
}

/** Raw port row (all columns) for admin edit — includes id + max + prices. */
export type PortAdminRow = {
    id: number;
    class: number;
    fuel: number;
    fuel_max: number;
    fuel_price: number;
    organics: number;
    org_max: number;
    org_price: number;
    equipment: number;
    equ_max: number;
    equ_price: number;
};
export async function getPortAdminRowByUniverseSector(
    sectorNumber: number,
    universeId: number,
    db: Queryable = pool,
): Promise<PortAdminRow | undefined> {
    const res = await db.query<PortAdminRow>(
        `SELECT p.id, p.class, p.fuel, p.fuel_max, p.fuel_price,
                p.organics, p.org_max, p.org_price,
                p.equipment, p.equ_max, p.equ_price
         FROM ports p
         JOIN sectors s ON p.sector_id = s.id
         WHERE s.sector_number = $1 AND s.universe_id = $2`,
        [sectorNumber, universeId],
    );
    return res.rows[0];
}

/** Does a port already exist for a given sector row? */
export async function portExistsForSector(
    sectorDbId: number,
    db: Queryable = pool,
): Promise<boolean> {
    const res = await db.query('SELECT id FROM ports WHERE sector_id = $1', [sectorDbId]);
    return res.rows.length > 0;
}

/** Admin update: replace a port's class + all quantities (max = qty) + prices. */
export async function updatePortFull(
    portId: number,
    data: {
        class: number;
        fuel: number;
        fuelPrice: number;
        organics: number;
        orgPrice: number;
        equipment: number;
        equPrice: number;
    },
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `UPDATE ports SET class = $1, fuel = $2, fuel_max = $2, fuel_price = $3,
                          organics = $4, org_max = $4, org_price = $5,
                          equipment = $6, equ_max = $6, equ_price = $7
         WHERE id = $8`,
        [
            data.class,
            data.fuel,
            data.fuelPrice,
            data.organics,
            data.orgPrice,
            data.equipment,
            data.equPrice,
            portId,
        ],
    );
}

/** Admin create: insert a new port in an existing sector. */
export async function insertPort(
    sectorDbId: number,
    data: {
        class: number;
        fuel: number;
        fuelPrice: number;
        organics: number;
        orgPrice: number;
        equipment: number;
        equPrice: number;
    },
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `INSERT INTO ports (sector_id, class, fuel, fuel_max, fuel_price,
                            organics, org_max, org_price,
                            equipment, equ_max, equ_price)
         VALUES ($1, $2, $3, $3, $4, $5, $5, $6, $7, $7, $8)`,
        [
            sectorDbId,
            data.class,
            data.fuel,
            data.fuelPrice,
            data.organics,
            data.orgPrice,
            data.equipment,
            data.equPrice,
        ],
    );
}

/** Delete a port by id. */
export async function deletePort(portId: number, db: Queryable = pool): Promise<void> {
    await db.query('DELETE FROM ports WHERE id = $1', [portId]);
}

/** Generate-time port insert (max values default to initial qty). */
export async function insertGeneratedPort(
    sectorId: number,
    portClass: number,
    data: {
        fuelQty: number;
        fuelPrice: number;
        orgQty: number;
        orgPrice: number;
        equQty: number;
        equPrice: number;
    },
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `INSERT INTO ports (sector_id, class, fuel, fuel_max, fuel_price, organics, org_max, org_price, equipment, equ_max, equ_price)
         VALUES ($1, $2, $3, $3, $4, $5, $5, $6, $7, $7, $8)`,
        [
            sectorId,
            portClass,
            data.fuelQty,
            data.fuelPrice,
            data.orgQty,
            data.orgPrice,
            data.equQty,
            data.equPrice,
        ],
    );
}

/** Upsert a "special" port (class 0 or 9) at a sector with zeroed quantities. */
export async function upsertSpecialPort(
    sectorId: number,
    portClass: 0 | 9,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `INSERT INTO ports (sector_id, class, fuel, fuel_max, fuel_price, organics, org_max, org_price, equipment, equ_max, equ_price)
         VALUES ($1, $2, 0, 0, 0, 0, 0, 0, 0, 0, 0)
         ON CONFLICT (sector_id) DO UPDATE
         SET class = $2, fuel = 0, fuel_max = 0, fuel_price = 0,
             organics = 0, org_max = 0, org_price = 0,
             equipment = 0, equ_max = 0, equ_price = 0`,
        [sectorId, portClass],
    );
}

/** Count ports in a universe (joined through sectors). */
export async function countPortsInUniverse(
    universeId: number,
    db: Queryable = pool,
): Promise<number> {
    const res = await db.query<{ count: number }>(
        `SELECT COUNT(*)::int FROM ports p
         JOIN sectors s ON p.sector_id = s.id
         WHERE s.universe_id = $1`,
        [universeId],
    );
    return res.rows[0]?.count ?? 0;
}

/** Lightweight port descriptor for sector display (class only). */
export async function getPortForSectorDisplay(
    sectorNumber: number,
    universeId: number,
    db: Queryable = pool,
): Promise<{ class: number } | null> {
    const res = await db.query<{ class: number }>(
        `SELECT p.class FROM ports p
         JOIN sectors s ON p.sector_id = s.id
         WHERE s.sector_number = $1 AND s.universe_id = $2`,
        [sectorNumber, universeId],
    );
    return res.rows[0] ?? null;
}

/** All hardware items with universe-specific price override (or item default). */
export async function getHardwarePricesForUniverse(
    universeId: number,
    db: Queryable = pool,
): Promise<HardwarePriceRow[]> {
    const res = await db.query<HardwarePriceRow>(
        `SELECT hi.name, hi.label, COALESCE(hp.price, hi.default_price) as price
         FROM hardware_item hi
         LEFT JOIN hardware_price hp ON hp.hardware_item_id = hi.id
           AND hp.template_id = (SELECT template_id FROM universes WHERE id = $1)
         ORDER BY hi.id`,
        [universeId],
    );
    return res.rows;
}

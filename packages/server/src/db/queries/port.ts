import { pool } from '../index.js';
import type { Queryable, HardwarePriceRow } from '../types.js';
import { PORT_CLASS_ACTIONS } from '@twnr/shared';

/** Whitelist of commodity column names — blocks SQL injection via dynamic column. */
const COMMODITY_COLUMN: Record<'fuel' | 'organics' | 'equipment', string> = {
    fuel: 'fuel',
    organics: 'organics',
    equipment: 'equipment',
};
export type Commodity = keyof typeof COMMODITY_COLUMN;

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

/** Prices are not stored — compute via shared/port-pricing.ts from quantity, max, and MCIC. */
export type PortFullRow = {
    sector_id: number;
    name: string;
    class: number;
    fuel: number;
    fuel_max: number;
    fuel_mcic: number;
    organics: number;
    org_max: number;
    org_mcic: number;
    equipment: number;
    equ_max: number;
    equ_mcic: number;
};
export async function getPortAtSector(
    sectorNumber: number,
    universeId: number,
    db: Queryable = pool,
): Promise<PortFullRow | undefined> {
    const res = await db.query<PortFullRow>(
        `SELECT s.sector_number as sector_id, p.name, p.class,
                p.fuel, p.fuel_max, p.fuel_mcic,
                p.organics, p.org_max, p.org_mcic,
                p.equipment, p.equ_max, p.equ_mcic
         FROM ports p JOIN sectors s ON p.sector_id = s.id
         WHERE s.sector_number = $1 AND s.universe_id = $2`,
        [sectorNumber, universeId],
    );
    return res.rows[0];
}

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

export type PortTradeRow = {
    port_id: number;
    class: number;
    fuel: number;
    fuel_max: number;
    fuel_mcic: number;
    organics: number;
    org_max: number;
    org_mcic: number;
    equipment: number;
    equ_max: number;
    equ_mcic: number;
};
export async function getPortTradeInfoForUpdate(
    sectorNumber: number,
    universeId: number,
    db: Queryable = pool,
): Promise<PortTradeRow | undefined> {
    const res = await db.query<PortTradeRow>(
        `SELECT p.id as port_id, p.class,
                p.fuel, p.fuel_max, p.fuel_mcic,
                p.organics, p.org_max, p.org_mcic,
                p.equipment, p.equ_max, p.equ_mcic
         FROM ports p JOIN sectors s ON p.sector_id = s.id
         WHERE s.sector_number = $1 AND s.universe_id = $2 FOR UPDATE OF p`,
        [sectorNumber, universeId],
    );
    return res.rows[0];
}

/** Signed delta; caller must keep the result within [0, max]. */
export async function adjustPortCommodity(
    portId: number,
    commodity: Commodity,
    delta: number,
    db: Queryable = pool,
): Promise<void> {
    const col = COMMODITY_COLUMN[commodity];
    await db.query(`UPDATE ports SET ${col} = ${col} + $1 WHERE id = $2`, [delta, portId]);
}

export async function insertGeneratedPort(
    sectorId: number,
    portClass: number,
    data: {
        fuelQty: number;
        fuelMax: number;
        fuelProd: number;
        fuelMcic: number;
        orgQty: number;
        orgMax: number;
        orgProd: number;
        orgMcic: number;
        equQty: number;
        equMax: number;
        equProd: number;
        equMcic: number;
    },
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `INSERT INTO ports (sector_id, name, class,
                            fuel, fuel_max, fuel_prod, fuel_mcic,
                            organics, org_max, org_prod, org_mcic,
                            equipment, equ_max, equ_prod, equ_mcic)
         VALUES ($1, (SELECT 'Port ' || sector_number FROM sectors WHERE id = $1),
                 $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
            sectorId,
            portClass,
            data.fuelQty,
            data.fuelMax,
            data.fuelProd,
            data.fuelMcic,
            data.orgQty,
            data.orgMax,
            data.orgProd,
            data.orgMcic,
            data.equQty,
            data.equMax,
            data.equProd,
            data.equMcic,
        ],
    );
}

export async function upsertSpecialPort(
    sectorId: number,
    portClass: 0 | 9,
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `INSERT INTO ports (sector_id, name, class,
                            fuel, fuel_max, fuel_prod, fuel_mcic,
                            organics, org_max, org_prod, org_mcic,
                            equipment, equ_max, equ_prod, equ_mcic)
         VALUES ($1, (SELECT 'Port ' || sector_number FROM sectors WHERE id = $1),
                 $2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
         ON CONFLICT (sector_id) DO UPDATE
         SET class = $2,
             fuel = 0, fuel_max = 0, fuel_prod = 0, fuel_mcic = 0,
             organics = 0, org_max = 0, org_prod = 0, org_mcic = 0,
             equipment = 0, equ_max = 0, equ_prod = 0, equ_mcic = 0`,
        [sectorId, portClass],
    );
}

/** Exactly one of owner.playerId/clanId must be non-null (table check constraint). */
export async function insertPlayerBuiltPort(
    sectorDbId: number,
    portClass: number,
    portName: string,
    owner: { playerId: number | null; clanId: number | null },
    data: {
        fuelMax: number;
        fuelProd: number;
        fuelMcic: number;
        fuelStock: number;
        orgMax: number;
        orgProd: number;
        orgMcic: number;
        orgStock: number;
        equMax: number;
        equProd: number;
        equMcic: number;
        equStock: number;
    },
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `INSERT INTO ports (sector_id, name, class,
                            owner_player_id, owner_clan_id,
                            fuel, fuel_max, fuel_prod, fuel_mcic,
                            organics, org_max, org_prod, org_mcic,
                            equipment, equ_max, equ_prod, equ_mcic)
         VALUES ($1, $2, $3, $4, $5,
                 $6, $7, $8, $9,
                 $10, $11, $12, $13,
                 $14, $15, $16, $17)`,
        [
            sectorDbId,
            portName,
            portClass,
            owner.playerId,
            owner.clanId,
            data.fuelStock,
            data.fuelMax,
            data.fuelProd,
            data.fuelMcic,
            data.orgStock,
            data.orgMax,
            data.orgProd,
            data.orgMcic,
            data.equStock,
            data.equMax,
            data.equProd,
            data.equMcic,
        ],
    );
}

/** Must stay a single statement so it is atomic under the trade transaction's FOR UPDATE. */
export async function applyPortUpgrade(
    portId: number,
    commodity: Commodity,
    units: number,
    db: Queryable = pool,
): Promise<void> {
    const col = COMMODITY_COLUMN[commodity];
    const maxCol = `${col === 'organics' ? 'org' : col === 'equipment' ? 'equ' : 'fuel'}_max`;
    const prodCol = `${col === 'organics' ? 'org' : col === 'equipment' ? 'equ' : 'fuel'}_prod`;
    await db.query(
        `UPDATE ports SET
            ${prodCol} = ${prodCol} + $1,
            ${maxCol} = ${maxCol} + $2,
            ${col} = ${col} + $2
         WHERE id = $3`,
        [units, units * 10, portId],
    );
}

export type PortConstructionRow = {
    sector_id: number;
    sector_number: number;
    universe_id: number;
    builder_player_id: number | null;
    owner_player_id: number | null;
    owner_clan_id: number | null;
    port_class: number;
    port_name: string;
    days_required: number;
    days_completed: number;
    started_at: Date;
    last_advance_attempt_at: Date;
};

/** Precondition: caller has verified credits, planet presence, and no existing port/construction. */
export async function insertPortConstruction(
    sectorDbId: number,
    data: {
        builderPlayerId: number;
        ownerPlayerId: number | null;
        ownerClanId: number | null;
        portClass: number;
        portName: string;
        daysRequired: number;
    },
    db: Queryable = pool,
): Promise<void> {
    await db.query(
        `INSERT INTO port_construction (sector_id, builder_player_id, owner_player_id,
                                        owner_clan_id, port_class, port_name, days_required)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
            sectorDbId,
            data.builderPlayerId,
            data.ownerPlayerId,
            data.ownerClanId,
            data.portClass,
            data.portName,
            data.daysRequired,
        ],
    );
}

export async function getPortConstructionAtSectorForUpdate(
    sectorNumber: number,
    universeId: number,
    db: Queryable = pool,
): Promise<PortConstructionRow | undefined> {
    const res = await db.query<PortConstructionRow>(
        `SELECT pc.sector_id, s.sector_number, s.universe_id,
                pc.builder_player_id, pc.owner_player_id, pc.owner_clan_id,
                pc.port_class, pc.port_name, pc.days_required, pc.days_completed,
                pc.started_at, pc.last_advance_attempt_at
         FROM port_construction pc
         JOIN sectors s ON s.id = pc.sector_id
         WHERE s.sector_number = $1 AND s.universe_id = $2
         FOR UPDATE OF pc`,
        [sectorNumber, universeId],
    );
    return res.rows[0];
}

export async function listConstructionsDueForAdvance(
    db: Queryable = pool,
): Promise<PortConstructionRow[]> {
    const res = await db.query<PortConstructionRow>(
        `SELECT pc.sector_id, s.sector_number, s.universe_id,
                pc.builder_player_id, pc.owner_player_id, pc.owner_clan_id,
                pc.port_class, pc.port_name, pc.days_required, pc.days_completed,
                pc.started_at, pc.last_advance_attempt_at
         FROM port_construction pc
         JOIN sectors s ON s.id = pc.sector_id
         WHERE pc.last_advance_attempt_at <= NOW() - INTERVAL '24 hours'`,
    );
    return res.rows;
}

/** The attempt timestamp advances even when progressed=false, so the next try waits another 24h. */
export async function recordConstructionAdvanceAttempt(
    sectorDbId: number,
    progressed: boolean,
    db: Queryable = pool,
): Promise<void> {
    if (progressed) {
        await db.query(
            `UPDATE port_construction
             SET days_completed = days_completed + 1, last_advance_attempt_at = NOW()
             WHERE sector_id = $1`,
            [sectorDbId],
        );
    } else {
        await db.query(
            `UPDATE port_construction SET last_advance_attempt_at = NOW() WHERE sector_id = $1`,
            [sectorDbId],
        );
    }
}

export async function deletePortConstruction(
    sectorDbId: number,
    db: Queryable = pool,
): Promise<void> {
    await db.query(`DELETE FROM port_construction WHERE sector_id = $1`, [sectorDbId]);
}

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

export async function getPortForSectorDisplay(
    sectorNumber: number,
    universeId: number,
    db: Queryable = pool,
): Promise<{ class: number; name: string } | null> {
    const res = await db.query<{ class: number; name: string }>(
        `SELECT p.class, p.name FROM ports p
         JOIN sectors s ON p.sector_id = s.id
         WHERE s.sector_number = $1 AND s.universe_id = $2`,
        [sectorNumber, universeId],
    );
    return res.rows[0] ?? null;
}

export async function getPortConstructionForSectorDisplay(
    sectorNumber: number,
    universeId: number,
    db: Queryable = pool,
): Promise<{ class: number; name: string; daysLeft: number } | null> {
    const res = await db.query<{
        class: number;
        name: string;
        days_required: number;
        days_completed: number;
    }>(
        `SELECT pc.port_class AS class, pc.port_name AS name,
                pc.days_required, pc.days_completed
         FROM port_construction pc
         JOIN sectors s ON s.id = pc.sector_id
         WHERE s.sector_number = $1 AND s.universe_id = $2`,
        [sectorNumber, universeId],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
        class: row.class,
        name: row.name,
        daysLeft: Math.max(0, row.days_required - row.days_completed),
    };
}

export async function listProducingPortIds(db: Queryable = pool): Promise<number[]> {
    const res = await db.query<{ id: number }>(
        `SELECT id FROM ports
         WHERE class BETWEEN 1 AND 8
           AND (fuel_prod > 0 OR org_prod > 0 OR equ_prod > 0)`,
    );
    return res.rows.map((r) => r.id);
}

/** Fractional-accumulator regen: a selling (S) commodity climbs toward max; a buying (B) one drains toward 0, which means ready-to-buy. Remainders roll into *_prod_accrual; stamps last_production_at. */
const ONE_HOUR_MS = 60 * 60 * 1000;
export async function settlePortProduction(
    portId: number,
    db: Queryable = pool,
): Promise<{ produced: boolean }> {
    const res = await db.query<{
        class: number;
        fuel: number;
        organics: number;
        equipment: number;
        fuel_max: number;
        org_max: number;
        equ_max: number;
        fuel_prod: number;
        org_prod: number;
        equ_prod: number;
        fuel_prod_accrual: number;
        org_prod_accrual: number;
        equ_prod_accrual: number;
        last_production_at: Date;
    }>(
        `SELECT class, fuel, organics, equipment,
                fuel_max, org_max, equ_max,
                fuel_prod, org_prod, equ_prod,
                fuel_prod_accrual, org_prod_accrual, equ_prod_accrual,
                last_production_at
         FROM ports
         WHERE id = $1
         FOR UPDATE`,
        [portId],
    );
    const row = res.rows[0];
    if (!row) return { produced: false };

    const actions = PORT_CLASS_ACTIONS[row.class];
    if (!actions) return { produced: false };

    const elapsedMs = Date.now() - new Date(row.last_production_at).getTime();
    if (elapsedMs <= 0) return { produced: false };
    const elapsedHours = elapsedMs / ONE_HOUR_MS;

    const settle = (
        stock: number,
        max: number,
        prod: number,
        accrual: number,
        action: 'B' | 'S',
    ): { stock: number; accrual: number } => {
        if (prod <= 0 || max <= 0) return { stock, accrual: 0 };
        const newAccrual = accrual + prod * elapsedHours;
        const whole = Math.floor(newAccrual);
        const newStock = action === 'S' ? Math.min(max, stock + whole) : Math.max(0, stock - whole);
        return { stock: newStock, accrual: newAccrual - whole };
    };

    const fuel = settle(row.fuel, row.fuel_max, row.fuel_prod, row.fuel_prod_accrual, actions.fuel);
    const org = settle(
        row.organics,
        row.org_max,
        row.org_prod,
        row.org_prod_accrual,
        actions.organics,
    );
    const equ = settle(
        row.equipment,
        row.equ_max,
        row.equ_prod,
        row.equ_prod_accrual,
        actions.equipment,
    );

    const produced =
        fuel.stock !== row.fuel || org.stock !== row.organics || equ.stock !== row.equipment;

    await db.query(
        `UPDATE ports SET
            fuel = $2, organics = $3, equipment = $4,
            fuel_prod_accrual = $5, org_prod_accrual = $6, equ_prod_accrual = $7,
            last_production_at = NOW()
         WHERE id = $1`,
        [portId, fuel.stock, org.stock, equ.stock, fuel.accrual, org.accrual, equ.accrual],
    );
    return { produced };
}

export async function getHardwarePricesForUniverse(
    universeId: number,
    db: Queryable = pool,
): Promise<HardwarePriceRow[]> {
    const res = await db.query<HardwarePriceRow>(
        `SELECT hi.name, hi.label, COALESCE(uhp.price, hi.default_price) as price
         FROM hardware_item hi
         LEFT JOIN universe_hardware_price uhp ON uhp.hardware_item_id = hi.id
           AND uhp.universe_id = $1
         ORDER BY hi.id`,
        [universeId],
    );
    return res.rows;
}

export type PortProductionRow = {
    fuel_prod: number;
    org_prod: number;
    equ_prod: number;
};

export async function getPortProductionAtSector(
    sectorNumber: number,
    universeId: number,
    db: Queryable = pool,
): Promise<PortProductionRow | undefined> {
    const res = await db.query<PortProductionRow>(
        `SELECT p.fuel_prod, p.org_prod, p.equ_prod
         FROM ports p JOIN sectors s ON p.sector_id = s.id
         WHERE s.sector_number = $1 AND s.universe_id = $2`,
        [sectorNumber, universeId],
    );
    return res.rows[0];
}

export type PortUpgradeInfoRow = {
    id: number;
    class: number;
    fuel_prod: number;
    org_prod: number;
    equ_prod: number;
    fuel_max: number;
    org_max: number;
    equ_max: number;
    fuel: number;
    organics: number;
    equipment: number;
};

export async function getPortUpgradeInfoForUpdate(
    sectorNumber: number,
    universeId: number,
    db: Queryable = pool,
): Promise<PortUpgradeInfoRow | undefined> {
    const res = await db.query<PortUpgradeInfoRow>(
        `SELECT p.id, p.class,
                p.fuel_prod, p.org_prod, p.equ_prod,
                p.fuel_max, p.org_max, p.equ_max,
                p.fuel, p.organics, p.equipment
         FROM ports p JOIN sectors s ON p.sector_id = s.id
         WHERE s.sector_number = $1 AND s.universe_id = $2
         FOR UPDATE OF p`,
        [sectorNumber, universeId],
    );
    return res.rows[0];
}

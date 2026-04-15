import { ServerMsgType } from '@twnr/shared';
import { sendEnvelope } from '../game-state.js';
import { pool } from '../db/index.js';

export async function handleShipInfo(playerId: number): Promise<void> {
    const query = `
        SELECT st.name AS ship_name, s.id AS ship_id, s.ship_type_id,
               s.drones, s.shields, s.holds,
               s.turns_per_warp, s.has_density_scanner,
               s.fuel, s.organics, s.equipment, s.colonists,
               p.turns, p.credits,
               st.max_drones, st.max_shields, st.max_holds
        FROM players p
        JOIN ships s ON p.ship_id = s.id
        JOIN ship_types st ON s.ship_type_id = st.id
        WHERE p.id = $1
    `;
    const result = await pool.query(query, [playerId]);
    if (result.rows.length === 0) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Ship not found' });
        return;
    }

    const row = result.rows[0];

    // Get hardware quantities
    const hwRes = await pool.query(
        `SELECT hi.name, COALESCE(sh.quantity, 0) as quantity
         FROM hardware_item hi
         LEFT JOIN ship_hardware sh ON sh.hardware_item_id = hi.id AND sh.ship_id = $1`,
        [row.ship_id],
    );
    const hardware: Record<string, number> = Object.fromEntries(
        hwRes.rows.map((r: any) => [r.name, r.quantity]),
    );

    // Get hardware max quantities
    const hwMaxRes = await pool.query(
        `SELECT hi.name, COALESCE(sth.max_quantity, 0) as max_quantity
         FROM hardware_item hi
         LEFT JOIN ship_type_hardware sth ON sth.hardware_item_id = hi.id AND sth.ship_type_id = $1`,
        [row.ship_type_id],
    );
    const hardwareMax: Record<string, number> = Object.fromEntries(
        hwMaxRes.rows.map((r: any) => [r.name, r.max_quantity]),
    );

    const holdsAvailable = row.holds - (row.fuel + row.organics + row.equipment + row.colonists);
    sendEnvelope(playerId, {
        type: ServerMsgType.ShipInfoResult,
        playerId,
        shipName: row.ship_name,
        drones: row.drones,
        shields: row.shields,
        maxDrones: row.max_drones,
        maxShields: row.max_shields,
        cargoLimit: row.holds,
        maxHolds: row.max_holds,
        cargoFuel: row.fuel,
        cargoOrganics: row.organics,
        cargoEquipment: row.equipment,
        cargoColonists: row.colonists,
        holdsAvailable,
        hardware,
        hardwareMax,
        turnsPerWarp: row.turns_per_warp,
        hasHyperwarpDrive: (hardware.hyperspace_1 || 0) > 0 || (hardware.hyperspace_2 || 0) > 0,
        turns: row.turns,
        credits: row.credits,
    });
}

export async function handleCargoInfo(playerId: number): Promise<void> {
    const cargoRes = await pool.query(
        'SELECT s.fuel, s.organics, s.equipment, s.colonists, p.credits FROM players p JOIN ships s ON p.ship_id = s.id WHERE p.id = $1',
        [playerId],
    );
    if (cargoRes.rows.length === 0) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Player not found' });
        return;
    }

    const c = cargoRes.rows[0];
    sendEnvelope(playerId, {
        type: ServerMsgType.CargoInfoResult,
        playerId,
        fuel: c.fuel,
        organics: c.organics,
        equipment: c.equipment,
        colonists: c.colonists,
        credits: c.credits,
    });
}

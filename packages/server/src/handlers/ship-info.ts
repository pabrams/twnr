import { ServerMsgType } from '@twnr/shared';
import { shipConfigs } from '../ship-config.js';
import { sendEnvelope } from '../game-state.js';
import { pool } from '../db/index.js';

export async function handleShipInfo(playerId: number): Promise<void> {
    const query = `
        SELECT ps.ship_name, ps.drones, ps.shields, ps.cargo_limit, ps.planet_busters, ps.terraform_devices,
               ps.turns_per_warp, ps.has_hyperwarp_drive,
               sc.fuel, sc.organics, sc.equipment, sc.colonists,
               p.turns
        FROM player_ships ps
        JOIN ship_cargo sc ON ps.player_id = sc.player_id
        JOIN players p ON ps.player_id = p.id
        WHERE ps.player_id = $1
    `;
    const result = await pool.query(query, [playerId]);
    if (result.rows.length === 0) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Ship not found' });
        return;
    }

    const row = result.rows[0];
    const config = shipConfigs[row.ship_name];
    if (!config) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Ship config missing' });
        return;
    }

    const holdsAvailable =
        row.cargo_limit - (row.fuel + row.organics + row.equipment + row.colonists);
    sendEnvelope(playerId, {
        type: ServerMsgType.ShipInfoResult,
        playerId,
        shipName: row.ship_name,
        drones: row.drones,
        shields: row.shields,
        maxDrones: config.maxDrones,
        maxShields: config.maxShields,
        cargoLimit: row.cargo_limit,
        maxHolds: config.maxHolds,
        cargoFuel: row.fuel,
        cargoOrganics: row.organics,
        cargoEquipment: row.equipment,
        cargoColonists: row.colonists,
        holdsAvailable,
        planetBusters: row.planet_busters,
        terraformDevices: row.terraform_devices,
        maxPlanetBusters: config.maxPlanetBusters || 0,
        maxTerraformDevices: config.maxTerraformDevices || 0,
        turnsPerWarp: row.turns_per_warp,
        hasHyperwarpDrive: row.has_hyperwarp_drive,
        turns: row.turns,
    });
}

export async function handleCargoInfo(playerId: number): Promise<void> {
    const cargoRes = await pool.query(
        'SELECT player_id, fuel, organics, equipment, colonists, credits FROM ship_cargo WHERE player_id = $1',
        [playerId],
    );
    if (cargoRes.rows.length === 0) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Player not found' });
        return;
    }

    const c = cargoRes.rows[0];
    sendEnvelope(playerId, {
        type: ServerMsgType.CargoInfoResult,
        playerId: c.player_id,
        fuel: c.fuel,
        organics: c.organics,
        equipment: c.equipment,
        colonists: c.colonists,
        credits: c.credits,
    });
}

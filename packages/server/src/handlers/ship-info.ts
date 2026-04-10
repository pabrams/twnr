import { ServerMsgType } from '@twnr/shared';
import { sendEnvelope } from '../game-state.js';
import { pool } from '../db/index.js';

export async function handleShipInfo(playerId: number): Promise<void> {
    const query = `
        SELECT st.name AS ship_name, s.drones, s.shields, s.holds, s.planet_busters, s.terraform_devices,
               s.turns_per_warp, s.has_hyperspace_1, s.has_hyperspace_2,
               s.has_visual_scanner, s.has_planet_scanner, s.has_density_scanner,
               s.cloaking_devices, s.corbomite, s.photon_torpedoes,
               s.buoys, s.proximity_mines, s.orbital_mines, s.seeker_mines,
               s.mine_disruptors, s.recon_drones,
               s.fuel, s.organics, s.equipment, s.colonists,
               p.turns, p.credits,
               st.max_drones, st.max_shields, st.max_holds,
               st.max_planet_busters, st.max_terraform_devices,
               st.max_buoy, st.max_proximity, st.max_orbital, st.max_seeker,
               st.max_cloaking, st.max_corbomite, st.max_photon,
               st.max_disruptors, st.max_recon_drones,
               st.can_have_hyperspace_1, st.can_have_hyperspace_2,
               st.can_have_visual_scanner, st.can_have_planet_scanner
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
        planetBusters: row.planet_busters,
        terraformDevices: row.terraform_devices,
        maxPlanetBusters: row.max_planet_busters || 0,
        maxTerraformDevices: row.max_terraform_devices || 0,
        turnsPerWarp: row.turns_per_warp,
        hasHyperwarpDrive: row.has_hyperspace_1 || row.has_hyperspace_2,
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

import { WebSocket } from 'ws';
import { ServerMsgType } from '@twnr/shared';
import { shipConfigs } from '../ship-config.js';
import { send } from '../game-state.js';
import { pool } from '../db/index.js';

export async function handleShipInfo(ws: WebSocket, playerId: number): Promise<void> {
    const query = `
        SELECT ps.ship_name, ps.fighters, ps.shields, ps.cargo_limit,
               sc.fuel, sc.organics, sc.equipment, sc.colonists
        FROM player_ships ps
        JOIN ship_cargo sc ON ps.player_id = sc.player_id
        WHERE ps.player_id = $1
    `;
    const result = await pool.query(query, [playerId]);
    if (result.rows.length === 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Ship not found' });
        return;
    }

    const row = result.rows[0];
    const config = shipConfigs[row.ship_name];
    if (!config) {
        send(ws, { type: ServerMsgType.Error, message: 'Ship config missing' });
        return;
    }

    const holdsAvailable =
        row.cargo_limit - (row.fuel + row.organics + row.equipment + row.colonists);
    send(ws, {
        type: ServerMsgType.ShipInfo,
        playerId,
        shipName: row.ship_name,
        fighters: row.fighters,
        shields: row.shields,
        maxFighters: config.maxFighters,
        maxShields: config.maxShields,
        cargoLimit: row.cargo_limit,
        maxHolds: config.maxHolds,
        cargoFuel: row.fuel,
        cargoOrganics: row.organics,
        cargoEquipment: row.equipment,
        cargoColonists: row.colonists,
        holdsAvailable,
    });
}

export async function handleCargoInfo(ws: WebSocket, playerId: number): Promise<void> {
    const cargoRes = await pool.query(
        'SELECT player_id, fuel, organics, equipment, colonists, credits FROM ship_cargo WHERE player_id = $1',
        [playerId],
    );
    if (cargoRes.rows.length === 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Player not found' });
        return;
    }

    const c = cargoRes.rows[0];
    send(ws, {
        type: ServerMsgType.CargoInfo,
        playerId: c.player_id,
        fuel: c.fuel,
        organics: c.organics,
        equipment: c.equipment,
        colonists: c.colonists,
        credits: c.credits,
    });
}

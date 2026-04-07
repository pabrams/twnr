import { WebSocket } from 'ws';
import { ServerMsgType } from '@twnr/shared';
import { shipConfigs } from '../ship-config.js';
import { sendEnvelope, getPlayerUniverseId } from '../game-state.js';
import { pool } from '../db/index.js';

export async function handleBuyShipTradein(
    ws: WebSocket,
    playerId: number,
    targetShipName: string,
): Promise<void> {
    const targetConfig = shipConfigs[targetShipName];
    if (!targetConfig) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Unknown ship' });
        return;
    }

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const pRes = await client.query(
            `
            SELECT p.current_sector, s.name as sector_name
            FROM players p
            JOIN sectors s ON p.current_sector = s.id AND p.universe_id = s.universe_id
            WHERE p.id = $1
        `,
            [playerId],
        );

        if (pRes.rows.length === 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }
        if (pRes.rows[0].sector_name !== 'Stardock') {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Not at Stardock' });
            return;
        }

        const cargoRes = await client.query(
            `
            SELECT sc.credits, sc.fuel, sc.organics, sc.equipment, sc.colonists, ps.ship_name
            FROM ship_cargo sc
            JOIN player_ships ps ON sc.player_id = ps.player_id
            WHERE sc.player_id = $1 FOR UPDATE
        `,
            [playerId],
        );

        if (cargoRes.rows.length === 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }

        const data = cargoRes.rows[0];
        if (data.ship_name === targetShipName) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Already on that ship' });
            return;
        }

        const currentConfig = shipConfigs[data.ship_name];
        const cost = targetConfig.price - currentConfig.price;
        if (cost > 0 && data.credits < cost) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Insufficient credits' });
            return;
        }

        const newCargoLimit = targetConfig.startingHolds;
        const currentCargo = data.fuel + data.organics + data.equipment + data.colonists;
        if (newCargoLimit < currentCargo) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, {
                type: ServerMsgType.Error,
                message: 'New ship has insufficient holds for current cargo',
            });
            return;
        }

        const turnsPerWarp = targetConfig.turnsPerWarp ?? 1;
        await client.query(
            `
            UPDATE player_ships
            SET ship_name = $1, fighters = 0, shields = 0, cargo_limit = $2, turns_per_warp = $3, has_hyperwarp_drive = FALSE
            WHERE player_id = $4
        `,
            [targetShipName, newCargoLimit, turnsPerWarp, playerId],
        );

        await client.query('UPDATE ship_cargo SET credits = credits - $1 WHERE player_id = $2', [
            cost,
            playerId,
        ]);
        await client.query('COMMIT');

        sendEnvelope(playerId, {
            type: ServerMsgType.BuyShipTradeinResult,
            shipName: targetShipName,
            credits: data.credits - cost,
            maxFighters: targetConfig.maxFighters,
            maxShields: targetConfig.maxShields,
            cargoLimit: newCargoLimit,
        });
    } catch {
        await client.query('ROLLBACK');
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
    }
}

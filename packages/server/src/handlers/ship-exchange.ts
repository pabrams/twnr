import { ServerMsgType } from '@twnr/shared';
import { sendEnvelope, getPlayerUniverseId } from '../game-state.js';
import { pool } from '../db/index.js';

export async function handleBuyShipTradein(
    playerId: number,
    targetShipName: string,
): Promise<void> {
    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Look up the target ship type
        const targetTypeRes = await client.query(
            `SELECT id, name, starting_holds, max_holds, max_drones, max_shields,
                    cost_drive, cost_computer, cost_hull, hold_cost,
                    turns_per_warp, can_have_hyperspace_1, can_have_hyperspace_2,
                    max_planet_busters, max_terraform_devices
             FROM ship_types WHERE name = $1`,
            [targetShipName],
        );
        if (targetTypeRes.rows.length === 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Unknown ship' });
            return;
        }
        const targetType = targetTypeRes.rows[0];

        const pRes = await client.query(
            `
            SELECT s.sector_number as current_sector, s.name as sector_name, p.current_sector_id
            FROM players p
            JOIN sectors s ON p.current_sector_id = s.id
            WHERE p.id = $1
        `,
            [playerId],
        );

        if (pRes.rows.length === 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }
        if (pRes.rows[0].sector_name !== 'Starbase') {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Not at Starbase' });
            return;
        }

        const cargoRes = await client.query(
            `
            SELECT p.credits, s.fuel, s.organics, s.equipment, s.colonists,
                   st.name AS ship_name,
                   st.cost_drive AS current_cost_drive, st.cost_computer AS current_cost_computer,
                   st.cost_hull AS current_cost_hull, st.hold_cost AS current_hold_cost,
                   s.id AS ship_id
            FROM players p
            JOIN ships s ON p.ship_id = s.id
            JOIN ship_types st ON s.ship_type_id = st.id
            WHERE p.id = $1 FOR UPDATE
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

        const targetPrice =
            targetType.cost_drive +
            targetType.cost_computer +
            targetType.cost_hull +
            targetType.hold_cost;
        const currentPrice =
            data.current_cost_drive +
            data.current_cost_computer +
            data.current_cost_hull +
            data.current_hold_cost;
        const cost = targetPrice - currentPrice;
        if (cost > 0 && data.credits < cost) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Insufficient credits' });
            return;
        }

        const newCargoLimit = targetType.starting_holds;
        const currentCargo = data.fuel + data.organics + data.equipment + data.colonists;
        if (newCargoLimit < currentCargo) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, {
                type: ServerMsgType.Error,
                message: 'New ship has insufficient holds for current cargo',
            });
            return;
        }

        // Create new ship, transferring cargo (all hardware reset to defaults)
        const newShipRes = await client.query(
            `
            INSERT INTO ships (owner_id, ship_type_id, sector_id, drones, shields, holds, turns_per_warp, fuel, organics, equipment, colonists)
            VALUES ($1, $2, $3, 0, 0, $4, $5, $6, $7, $8, $9)
            RETURNING id
        `,
            [
                playerId,
                targetType.id,
                pRes.rows[0].current_sector_id,
                newCargoLimit,
                targetType.turns_per_warp,
                data.fuel,
                data.organics,
                data.equipment,
                data.colonists,
            ],
        );

        // Update player to point to new ship and deduct credits
        await client.query(
            'UPDATE players SET ship_id = $1, credits = credits - $2 WHERE id = $3',
            [newShipRes.rows[0].id, cost, playerId],
        );

        // Delete old ship (no multiple active ships yet)
        await client.query('DELETE FROM ships WHERE id = $1', [data.ship_id]);

        await client.query('COMMIT');

        sendEnvelope(playerId, {
            type: ServerMsgType.BuyShipTradeinResult,
            shipName: targetShipName,
            credits: data.credits - cost,
            maxDrones: targetType.max_drones,
            maxShields: targetType.max_shields,
            cargoLimit: newCargoLimit,
        });
    } catch {
        await client.query('ROLLBACK');
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
    }
}

import { ServerMsgType } from '@twnr/shared';
import { sendEnvelope, getPlayerUniverseId, players, setPlayerMenu } from '../game-state.js';
import { pool } from '../db/index.js';

function calculateShipPrice(shipType: {
    cost_drive: number;
    cost_computer: number;
    cost_hull: number;
    hold_cost: number;
    starting_holds: number;
}): number {
    return (
        shipType.cost_drive +
        shipType.cost_computer +
        shipType.cost_hull +
        shipType.starting_holds * shipType.hold_cost
    );
}

export async function handleBuyShipTradein(
    playerId: number,
    targetShipName: string,
): Promise<void> {
    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    const player = players[playerId];
    if (!player?.at_starbase) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Not at Starbase' });
        return;
    }

    // Always return to shipyards menu regardless of outcome
    await setPlayerMenu(playerId, 'shipyards');

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

        const cargoRes = await client.query(
            `
            SELECT p.credits, p.current_sector_id,
                   st.name AS ship_name,
                   st.cost_drive AS current_cost_drive, st.cost_computer AS current_cost_computer,
                   st.cost_hull AS current_cost_hull, st.hold_cost AS current_hold_cost,
                   st.starting_holds AS current_starting_holds,
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

        const targetPrice = calculateShipPrice(targetType);
        const currentPrice = calculateShipPrice({
            cost_drive: data.current_cost_drive,
            cost_computer: data.current_cost_computer,
            cost_hull: data.current_cost_hull,
            hold_cost: data.current_hold_cost,
            starting_holds: data.current_starting_holds,
        });
        const cost = targetPrice - currentPrice;
        if (cost > 0 && data.credits < cost) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Insufficient credits' });
            return;
        }

        const newCargoLimit = targetType.starting_holds;

        // Create new empty ship (old ship + cargo get deleted)
        const newShipRes = await client.query(
            `INSERT INTO ships (owner_id, ship_type_id, sector_id, drones, shields, holds, turns_per_warp, fuel, organics, equipment, colonists)
             VALUES ($1, $2, $3, 0, 0, $4, $5, 0, 0, 0, 0)
             RETURNING id`,
            [
                playerId,
                targetType.id,
                data.current_sector_id,
                newCargoLimit,
                targetType.turns_per_warp,
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
    } catch (err) {
        console.error('ship-exchange error:', err);
        await client.query('ROLLBACK');
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
    }
}

export async function handleBuyShipNew(playerId: number, targetShipName: string): Promise<void> {
    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    const player = players[playerId];
    if (!player?.at_starbase) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Not at Starbase' });
        return;
    }

    // Always return to shipyards menu regardless of outcome
    await setPlayerMenu(playerId, 'shipyards');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const targetTypeRes = await client.query(
            `SELECT id, name, starting_holds, max_holds, max_drones, max_shields,
                    cost_drive, cost_computer, cost_hull, hold_cost,
                    turns_per_warp
             FROM ship_types WHERE name = $1`,
            [targetShipName],
        );
        if (targetTypeRes.rows.length === 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Unknown ship' });
            return;
        }
        const targetType = targetTypeRes.rows[0];
        const price = calculateShipPrice(targetType);

        const pRes = await client.query(
            `SELECT p.credits, p.current_sector_id, sh.id AS ship_id,
                    st.name AS ship_name
             FROM players p
             JOIN ships sh ON p.ship_id = sh.id
             JOIN ship_types st ON sh.ship_type_id = st.id
             WHERE p.id = $1 FOR UPDATE`,
            [playerId],
        );
        if (pRes.rows.length === 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }
        const data = pRes.rows[0];

        if (data.ship_name === targetShipName) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Already on that ship' });
            return;
        }

        if (data.credits < price) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Insufficient credits' });
            return;
        }

        const newCargoLimit = targetType.starting_holds;

        // Create new ship (empty — old ship keeps its cargo)
        const newShipRes = await client.query(
            `INSERT INTO ships (owner_id, ship_type_id, sector_id, drones, shields, holds, turns_per_warp, fuel, organics, equipment, colonists)
             VALUES ($1, $2, $3, 0, 0, $4, $5, 0, 0, 0, 0)
             RETURNING id`,
            [
                playerId,
                targetType.id,
                data.current_sector_id,
                newCargoLimit,
                targetType.turns_per_warp,
            ],
        );

        // Update player to new ship and deduct credits
        await client.query(
            'UPDATE players SET ship_id = $1, credits = credits - $2 WHERE id = $3',
            [newShipRes.rows[0].id, price, playerId],
        );

        await client.query('COMMIT');

        sendEnvelope(playerId, {
            type: ServerMsgType.BuyShipNewResult,
            shipName: targetShipName,
            credits: data.credits - price,
            maxDrones: targetType.max_drones,
            maxShields: targetType.max_shields,
            cargoLimit: newCargoLimit,
        });
    } catch (err) {
        console.error('ship-exchange error:', err);
        await client.query('ROLLBACK');
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
    }
}

import { ServerMsgType } from '@twnr/shared';
import { sendEnvelope, getPlayerUniverseId, players, setPlayerMenu } from '../game-state.js';
import { pool } from '../db/index.js';
import {
    getShipTypeByName,
    getPlayerShipTradeInfoForUpdate,
    getPlayerShipBuyInfoForUpdate,
    insertEmptyShip,
    setPlayerShipAndDeductCredits,
    deleteShipById,
    type ShipTypeRow,
} from '../db/queries/ship.js';

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

        const targetType: ShipTypeRow | undefined = await getShipTypeByName(targetShipName, client);
        if (!targetType) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Unknown ship' });
            return;
        }

        const data = await getPlayerShipTradeInfoForUpdate(playerId, client);
        if (!data) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }

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

        const newShipId = await insertEmptyShip(
            playerId,
            targetType.id,
            data.current_sector_id,
            newCargoLimit,
            targetType.turns_per_warp,
            client,
        );
        await setPlayerShipAndDeductCredits(playerId, newShipId, cost, client);
        await deleteShipById(data.ship_id, client);

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

    await setPlayerMenu(playerId, 'shipyards');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const targetType = await getShipTypeByName(targetShipName, client);
        if (!targetType) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Unknown ship' });
            return;
        }
        const price = calculateShipPrice(targetType);

        const data = await getPlayerShipBuyInfoForUpdate(playerId, client);
        if (!data) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }

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

        const newShipId = await insertEmptyShip(
            playerId,
            targetType.id,
            data.current_sector_id,
            newCargoLimit,
            targetType.turns_per_warp,
            client,
        );
        await setPlayerShipAndDeductCredits(playerId, newShipId, price, client);

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

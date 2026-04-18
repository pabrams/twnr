import { ServerMsgType } from '@twnr/shared';
import { sendEnvelope, getPlayerUniverseId, setPlayerMenu, players } from '../game-state.js';
import { pool } from '../db/index.js';
import { getCurrentSector, deductCredits } from '../db/queries/player.js';
import {
    getShipUpgradeInfoForUpdate,
    incrementShipDrones,
    incrementShipShields,
    incrementShipHolds,
} from '../db/queries/ship.js';
import { getPortClassAtSector } from '../db/queries/port.js';
import { class0Prices } from '../game-config.js';
import { checkAndDeductTurns } from '../turn-logic.js';

/** Returns true iff player is at a place where they can buy Class-0 upgrades. */
async function isAtClass0OrStarbase(
    playerId: number,
    universeId: number,
    client: Parameters<typeof getCurrentSector>[1],
): Promise<boolean> {
    if (players[playerId]?.at_starbase) return true;
    const currentSector = await getCurrentSector(playerId, client);
    if (currentSector === undefined) return false;
    const portClass = await getPortClassAtSector(currentSector, universeId, client);
    return portClass === 0;
}

export async function handleBuyDrones(playerId: number, quantity: number): Promise<void> {
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Invalid quantity' });
        return;
    }

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        if (!(await isAtClass0OrStarbase(playerId, universeId, client))) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, {
                type: ServerMsgType.Error,
                message: 'Not at a class 0 port or starbase',
            });
            return;
        }

        const data = await getShipUpgradeInfoForUpdate(playerId, client);
        if (!data) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }

        if (data.drones + qty > data.max_drones) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Exceeds maximum' });
            return;
        }

        const cost = qty * class0Prices.dronePrice;
        if (data.credits < cost) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Insufficient credits' });
            return;
        }

        await incrementShipDrones(playerId, qty, client);
        await deductCredits(playerId, cost, client);
        await client.query('COMMIT');

        await setPlayerMenu(playerId, 'class0');
        sendEnvelope(playerId, {
            type: ServerMsgType.BuyDronesResult,
            credits: data.credits - cost,
            drones: data.drones + qty,
        });
    } catch {
        await client.query('ROLLBACK');
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
    }
}

export async function handleBuyShields(playerId: number, quantity: number): Promise<void> {
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Invalid quantity' });
        return;
    }

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        if (!(await isAtClass0OrStarbase(playerId, universeId, client))) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, {
                type: ServerMsgType.Error,
                message: 'Not at a class 0 port or starbase',
            });
            return;
        }

        const data = await getShipUpgradeInfoForUpdate(playerId, client);
        if (!data) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }

        if (data.shields + qty > data.max_shields) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Exceeds maximum' });
            return;
        }

        const cost = qty * class0Prices.shieldPrice;
        if (data.credits < cost) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Insufficient credits' });
            return;
        }

        await incrementShipShields(playerId, qty, client);
        await deductCredits(playerId, cost, client);
        await client.query('COMMIT');

        await setPlayerMenu(playerId, 'class0');
        sendEnvelope(playerId, {
            type: ServerMsgType.BuyShieldsResult,
            credits: data.credits - cost,
            shields: data.shields + qty,
        });
    } catch {
        await client.query('ROLLBACK');
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
    }
}

export async function handleBuyHolds(playerId: number, quantity: number): Promise<void> {
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Invalid quantity' });
        return;
    }

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        if (!(await isAtClass0OrStarbase(playerId, universeId, client))) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, {
                type: ServerMsgType.Error,
                message: 'Not at a class 0 port or starbase',
            });
            return;
        }

        const turnResult = await checkAndDeductTurns(playerId, universeId, 1, client);
        if (!turnResult.allowed) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Insufficient turns' });
            return;
        }

        const data = await getShipUpgradeInfoForUpdate(playerId, client);
        if (!data) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }

        if (data.holds + qty > data.max_holds) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Exceeds maximum' });
            return;
        }

        const cost = qty * class0Prices.holdPrice;
        if (data.credits < cost) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Insufficient credits' });
            return;
        }

        await incrementShipHolds(playerId, qty, client);
        await deductCredits(playerId, cost, client);
        await client.query('COMMIT');

        await setPlayerMenu(playerId, 'class0');
        sendEnvelope(playerId, {
            type: ServerMsgType.BuyHoldsResult,
            credits: data.credits - cost,
            cargoLimit: data.holds + qty,
            turnsUsed: turnResult.turnsUsed,
        });
    } catch {
        await client.query('ROLLBACK');
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
    }
}

import { ServerMsgType } from '@twnr/shared';
import { sendEnvelope, getPlayerUniverseId, setPlayerMenu } from '../game-state.js';
import { pool } from '../db/index.js';
import { class0Prices } from '../game-config.js';
import { checkAndDeductTurns } from '../turn-logic.js';

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
        const pRes = await client.query(
            'SELECT s.sector_number as current_sector FROM players p JOIN sectors s ON p.current_sector_id = s.id WHERE p.id = $1',
            [playerId],
        );
        if (pRes.rows.length === 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }
        const currentSector = pRes.rows[0].current_sector;

        const portRes = await client.query(
            `SELECT p.class FROM ports p JOIN sectors s ON p.sector_id = s.id
             WHERE s.sector_number = $1 AND s.universe_id = $2`,
            [currentSector, universeId],
        );
        if (portRes.rows.length === 0 || portRes.rows[0].class !== 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Not at a class 0 port' });
            return;
        }

        const cargoRes = await client.query(
            `
            SELECT p.credits, s.drones, s.shields, s.holds, st.max_drones
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

        await client.query(
            'UPDATE ships SET drones = drones + $1 WHERE id = (SELECT ship_id FROM players WHERE id = $2)',
            [qty, playerId],
        );
        await client.query('UPDATE players SET credits = credits - $1 WHERE id = $2', [
            cost,
            playerId,
        ]);
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
        const pRes = await client.query(
            'SELECT s.sector_number as current_sector FROM players p JOIN sectors s ON p.current_sector_id = s.id WHERE p.id = $1',
            [playerId],
        );
        if (pRes.rows.length === 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }
        const currentSector = pRes.rows[0].current_sector;

        const portRes = await client.query(
            `SELECT p.class FROM ports p JOIN sectors s ON p.sector_id = s.id
             WHERE s.sector_number = $1 AND s.universe_id = $2`,
            [currentSector, universeId],
        );
        if (portRes.rows.length === 0 || portRes.rows[0].class !== 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Not at a class 0 port' });
            return;
        }

        const cargoRes = await client.query(
            `
            SELECT p.credits, s.drones, s.shields, s.holds, st.max_shields
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

        await client.query(
            'UPDATE ships SET shields = shields + $1 WHERE id = (SELECT ship_id FROM players WHERE id = $2)',
            [qty, playerId],
        );
        await client.query('UPDATE players SET credits = credits - $1 WHERE id = $2', [
            cost,
            playerId,
        ]);
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
        const pRes = await client.query(
            'SELECT s.sector_number as current_sector FROM players p JOIN sectors s ON p.current_sector_id = s.id WHERE p.id = $1',
            [playerId],
        );
        if (pRes.rows.length === 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }
        const currentSector = pRes.rows[0].current_sector;

        const portRes = await client.query(
            `SELECT p.class FROM ports p JOIN sectors s ON p.sector_id = s.id
             WHERE s.sector_number = $1 AND s.universe_id = $2`,
            [currentSector, universeId],
        );
        if (portRes.rows.length === 0 || portRes.rows[0].class !== 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Not at a class 0 port' });
            return;
        }

        // Check turns
        const turnResult = await checkAndDeductTurns(playerId, universeId, 1);
        if (!turnResult.allowed) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Insufficient turns' });
            return;
        }

        const cargoRes = await client.query(
            `
            SELECT p.credits, s.drones, s.shields, s.holds, st.max_holds
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

        await client.query(
            'UPDATE ships SET holds = holds + $1 WHERE id = (SELECT ship_id FROM players WHERE id = $2)',
            [qty, playerId],
        );
        await client.query('UPDATE players SET credits = credits - $1 WHERE id = $2', [
            cost,
            playerId,
        ]);
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

import { ServerMsgType } from '@twnr/shared';
import { shipConfigs } from '../ship-config.js';
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
            SELECT sc.credits, ps.ship_name, ps.drones, ps.shields, ps.cargo_limit
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
        const config = shipConfigs[data.ship_name];
        if (data.drones + qty > config.maxDrones) {
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

        await client.query('UPDATE player_ships SET drones = drones + $1 WHERE player_id = $2', [
            qty,
            playerId,
        ]);
        await client.query('UPDATE ship_cargo SET credits = credits - $1 WHERE player_id = $2', [
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
            SELECT sc.credits, ps.ship_name, ps.drones, ps.shields, ps.cargo_limit
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
        const config = shipConfigs[data.ship_name];
        if (data.shields + qty > config.maxShields) {
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

        await client.query('UPDATE player_ships SET shields = shields + $1 WHERE player_id = $2', [
            qty,
            playerId,
        ]);
        await client.query('UPDATE ship_cargo SET credits = credits - $1 WHERE player_id = $2', [
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
            SELECT sc.credits, ps.ship_name, ps.drones, ps.shields, ps.cargo_limit
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
        const config = shipConfigs[data.ship_name];
        if (data.cargo_limit + qty > config.maxHolds) {
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
            'UPDATE player_ships SET cargo_limit = cargo_limit + $1 WHERE player_id = $2',
            [qty, playerId],
        );
        await client.query('UPDATE ship_cargo SET credits = credits - $1 WHERE player_id = $2', [
            cost,
            playerId,
        ]);
        await client.query('COMMIT');

        await setPlayerMenu(playerId, 'class0');
        sendEnvelope(playerId, {
            type: ServerMsgType.BuyHoldsResult,
            credits: data.credits - cost,
            cargoLimit: data.cargo_limit + qty,
            turnsUsed: turnResult.turnsUsed,
        });
    } catch {
        await client.query('ROLLBACK');
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
    }
}

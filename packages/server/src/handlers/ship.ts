import { WebSocket } from 'ws';
import { ServerMsgType } from '@twnr/shared';
import { shipConfigs } from '../ship-config.js';
import { send, getPlayerUniverseId } from '../game-state.js';
import { pool } from '../db/index.js';
import { class0Prices } from '../game-config.js';

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

export async function handleBuyFighters(
    ws: WebSocket,
    playerId: number,
    quantity: number,
): Promise<void> {
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Invalid quantity' });
        return;
    }

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const pRes = await client.query('SELECT current_sector FROM players WHERE id = $1', [
            playerId,
        ]);
        if (pRes.rows.length === 0) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }
        const currentSector = pRes.rows[0].current_sector;

        const portRes = await client.query(
            'SELECT class FROM ports WHERE sector_id = $1 AND universe_id = $2',
            [currentSector, universeId],
        );
        if (portRes.rows.length === 0 || portRes.rows[0].class !== 0) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Not at a class 0 port' });
            return;
        }

        const cargoRes = await client.query(
            `
            SELECT sc.credits, ps.ship_name, ps.fighters, ps.shields, ps.cargo_limit
            FROM ship_cargo sc
            JOIN player_ships ps ON sc.player_id = ps.player_id
            WHERE sc.player_id = $1 FOR UPDATE
        `,
            [playerId],
        );
        if (cargoRes.rows.length === 0) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }

        const data = cargoRes.rows[0];
        const config = shipConfigs[data.ship_name];
        if (data.fighters + qty > config.maxFighters) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Exceeds maximum' });
            return;
        }

        const cost = qty * class0Prices.fighterPrice;
        if (data.credits < cost) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Insufficient credits' });
            return;
        }

        await client.query(
            'UPDATE player_ships SET fighters = fighters + $1 WHERE player_id = $2',
            [qty, playerId],
        );
        await client.query('UPDATE ship_cargo SET credits = credits - $1 WHERE player_id = $2', [
            cost,
            playerId,
        ]);
        await client.query('COMMIT');

        send(ws, {
            type: ServerMsgType.BuyResult,
            credits: data.credits - cost,
            fighters: data.fighters + qty,
            shields: data.shields,
            cargoLimit: data.cargo_limit,
        });
    } catch {
        await client.query('ROLLBACK');
        send(ws, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
    }
}

export async function handleBuyShields(
    ws: WebSocket,
    playerId: number,
    quantity: number,
): Promise<void> {
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Invalid quantity' });
        return;
    }

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const pRes = await client.query('SELECT current_sector FROM players WHERE id = $1', [
            playerId,
        ]);
        if (pRes.rows.length === 0) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }
        const currentSector = pRes.rows[0].current_sector;

        const portRes = await client.query(
            'SELECT class FROM ports WHERE sector_id = $1 AND universe_id = $2',
            [currentSector, universeId],
        );
        if (portRes.rows.length === 0 || portRes.rows[0].class !== 0) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Not at a class 0 port' });
            return;
        }

        const cargoRes = await client.query(
            `
            SELECT sc.credits, ps.ship_name, ps.fighters, ps.shields, ps.cargo_limit
            FROM ship_cargo sc
            JOIN player_ships ps ON sc.player_id = ps.player_id
            WHERE sc.player_id = $1 FOR UPDATE
        `,
            [playerId],
        );
        if (cargoRes.rows.length === 0) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }

        const data = cargoRes.rows[0];
        const config = shipConfigs[data.ship_name];
        if (data.shields + qty > config.maxShields) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Exceeds maximum' });
            return;
        }

        const cost = qty * class0Prices.shieldPrice;
        if (data.credits < cost) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Insufficient credits' });
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

        send(ws, {
            type: ServerMsgType.BuyResult,
            credits: data.credits - cost,
            fighters: data.fighters,
            shields: data.shields + qty,
            cargoLimit: data.cargo_limit,
        });
    } catch {
        await client.query('ROLLBACK');
        send(ws, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
    }
}

export async function handleBuyHolds(
    ws: WebSocket,
    playerId: number,
    quantity: number,
): Promise<void> {
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Invalid quantity' });
        return;
    }

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const pRes = await client.query('SELECT current_sector FROM players WHERE id = $1', [
            playerId,
        ]);
        if (pRes.rows.length === 0) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }
        const currentSector = pRes.rows[0].current_sector;

        const portRes = await client.query(
            'SELECT class FROM ports WHERE sector_id = $1 AND universe_id = $2',
            [currentSector, universeId],
        );
        if (portRes.rows.length === 0 || portRes.rows[0].class !== 0) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Not at a class 0 port' });
            return;
        }

        const cargoRes = await client.query(
            `
            SELECT sc.credits, ps.ship_name, ps.fighters, ps.shields, ps.cargo_limit
            FROM ship_cargo sc
            JOIN player_ships ps ON sc.player_id = ps.player_id
            WHERE sc.player_id = $1 FOR UPDATE
        `,
            [playerId],
        );
        if (cargoRes.rows.length === 0) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }

        const data = cargoRes.rows[0];
        const config = shipConfigs[data.ship_name];
        if (data.cargo_limit + qty > config.maxHolds) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Exceeds maximum' });
            return;
        }

        const cost = qty * class0Prices.holdPrice;
        if (data.credits < cost) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Insufficient credits' });
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

        send(ws, {
            type: ServerMsgType.BuyResult,
            credits: data.credits - cost,
            fighters: data.fighters,
            shields: data.shields,
            cargoLimit: data.cargo_limit + qty,
        });
    } catch {
        await client.query('ROLLBACK');
        send(ws, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
    }
}

export async function handleShipExchange(
    ws: WebSocket,
    playerId: number,
    targetShipName: string,
): Promise<void> {
    const targetConfig = shipConfigs[targetShipName];
    if (!targetConfig) {
        send(ws, { type: ServerMsgType.Error, message: 'Unknown ship' });
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
            send(ws, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }
        if (pRes.rows[0].sector_name !== 'Stardock') {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Not at Stardock' });
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
            send(ws, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }

        const data = cargoRes.rows[0];
        if (data.ship_name === targetShipName) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Already on that ship' });
            return;
        }

        const currentConfig = shipConfigs[data.ship_name];
        const cost = targetConfig.price - currentConfig.price;
        if (cost > 0 && data.credits < cost) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Insufficient credits' });
            return;
        }

        const newCargoLimit = targetConfig.startingHolds;
        const currentCargo = data.fuel + data.organics + data.equipment + data.colonists;
        if (newCargoLimit < currentCargo) {
            await client.query('ROLLBACK');
            send(ws, {
                type: ServerMsgType.Error,
                message: 'New ship has insufficient holds for current cargo',
            });
            return;
        }

        await client.query(
            `
            UPDATE player_ships
            SET ship_name = $1, fighters = 0, shields = 0, cargo_limit = $2
            WHERE player_id = $3
        `,
            [targetShipName, newCargoLimit, playerId],
        );

        await client.query('UPDATE ship_cargo SET credits = credits - $1 WHERE player_id = $2', [
            cost,
            playerId,
        ]);
        await client.query('COMMIT');

        send(ws, {
            type: ServerMsgType.ShipExchangeResult,
            shipName: targetShipName,
            credits: data.credits - cost,
            maxFighters: targetConfig.maxFighters,
            maxShields: targetConfig.maxShields,
            cargoLimit: newCargoLimit,
        });
    } catch {
        await client.query('ROLLBACK');
        send(ws, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
    }
}

export async function handleJettison(ws: WebSocket, playerId: number): Promise<void> {
    const result = await pool.query(
        'UPDATE ship_cargo SET fuel = 0, organics = 0, equipment = 0, colonists = 0 WHERE player_id = $1 RETURNING credits',
        [playerId],
    );
    if (result.rows.length === 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Player not found' });
        return;
    }
    send(ws, {
        type: ServerMsgType.PortTransactionResult,
        credits: result.rows[0].credits,
        cargo: { fuel: 0, organics: 0, equipment: 0, colonists: 0 },
    });
}

import { WebSocket } from 'ws';
import { ServerMsgType } from '@twnr/shared';
import { players, send } from '../game-state.js';
import { pool } from '../db/index.js';

export async function handleLand(ws: WebSocket, playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (player.pendingEncounter) {
        send(ws, { type: ServerMsgType.Error, message: 'Resolve fighter encounter first' });
        return;
    }

    const planetRes = await pool.query(
        'SELECT name, type, colonists FROM planets WHERE sector_id = $1 AND universe_id = $2',
        [player.sector, player.universeId],
    );

    if (planetRes.rows.length === 0) {
        send(ws, {
            type: ServerMsgType.PlanetInfo,
            sectorId: player.sector,
            name: '',
            planetType: '',
            colonists: 0,
            hasPlanet: false,
        });
        return;
    }

    const planet = planetRes.rows[0];
    send(ws, {
        type: ServerMsgType.PlanetInfo,
        sectorId: player.sector,
        name: planet.name,
        planetType: planet.type,
        colonists: planet.colonists,
        hasPlanet: true,
    });
}

export async function handleTakeColonists(
    ws: WebSocket,
    playerId: number,
    quantity: number,
): Promise<void> {
    const qty = Number.isInteger(quantity) ? quantity : 0;
    if (qty <= 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Invalid quantity' });
        return;
    }

    const player = players[playerId];
    if (!player) return;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const planetRes = await client.query(
            'SELECT colonists FROM planets WHERE sector_id = $1 AND universe_id = $2 FOR UPDATE',
            [player.sector, player.universeId],
        );
        if (planetRes.rows.length === 0) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'No planet in this sector' });
            return;
        }

        const cargoRes = await client.query(
            `SELECT sc.fuel, sc.organics, sc.equipment, sc.colonists, ps.cargo_limit
             FROM ship_cargo sc
             JOIN player_ships ps ON sc.player_id = ps.player_id
             WHERE sc.player_id = $1 FOR UPDATE`,
            [playerId],
        );
        if (cargoRes.rows.length === 0) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }

        const cargo = cargoRes.rows[0];
        const holdsUsed = cargo.fuel + cargo.organics + cargo.equipment + cargo.colonists;
        const holdsFree = cargo.cargo_limit - holdsUsed;

        if (qty > holdsFree) {
            await client.query('ROLLBACK');
            send(ws, {
                type: ServerMsgType.Error,
                message: `Not enough empty holds. You have ${holdsFree} free.`,
            });
            return;
        }

        const planetColonists = planetRes.rows[0].colonists;
        if (qty > planetColonists) {
            await client.query('ROLLBACK');
            send(ws, {
                type: ServerMsgType.Error,
                message: `Planet only has ${planetColonists} colonists.`,
            });
            return;
        }

        await client.query(
            'UPDATE planets SET colonists = colonists - $1 WHERE sector_id = $2 AND universe_id = $3',
            [qty, player.sector, player.universeId],
        );
        await client.query(
            'UPDATE ship_cargo SET colonists = colonists + $1 WHERE player_id = $2',
            [qty, playerId],
        );
        await client.query('COMMIT');

        send(ws, {
            type: ServerMsgType.ColonistResult,
            action: 'take',
            quantity: qty,
            planetColonists: planetColonists - qty,
            holdsUsed: qty,
            holdsFree: holdsFree - qty,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Take colonists error', err);
        send(ws, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
    }
}

export async function handleLeaveColonists(
    ws: WebSocket,
    playerId: number,
    quantity: number,
): Promise<void> {
    const qty = Number.isInteger(quantity) ? quantity : 0;
    if (qty <= 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Invalid quantity' });
        return;
    }

    const player = players[playerId];
    if (!player) return;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const planetRes = await client.query(
            'SELECT colonists FROM planets WHERE sector_id = $1 AND universe_id = $2 FOR UPDATE',
            [player.sector, player.universeId],
        );
        if (planetRes.rows.length === 0) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'No planet in this sector' });
            return;
        }

        const cargoRes = await client.query(
            'SELECT colonists FROM ship_cargo WHERE player_id = $1 FOR UPDATE',
            [playerId],
        );
        if (cargoRes.rows.length === 0 || cargoRes.rows[0].colonists < qty) {
            await client.query('ROLLBACK');
            send(ws, {
                type: ServerMsgType.Error,
                message: `You only have ${cargoRes.rows[0]?.colonists ?? 0} colonists aboard.`,
            });
            return;
        }

        await client.query(
            'UPDATE planets SET colonists = colonists + $1 WHERE sector_id = $2 AND universe_id = $3',
            [qty, player.sector, player.universeId],
        );
        await client.query(
            'UPDATE ship_cargo SET colonists = colonists - $1 WHERE player_id = $2',
            [qty, playerId],
        );
        await client.query('COMMIT');

        send(ws, {
            type: ServerMsgType.ColonistResult,
            action: 'leave',
            quantity: qty,
            planetColonists: planetRes.rows[0].colonists + qty,
            holdsUsed: 0,
            holdsFree: 0,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Leave colonists error', err);
        send(ws, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
    }
}

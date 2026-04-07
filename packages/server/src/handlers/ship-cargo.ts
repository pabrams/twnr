import { WebSocket } from 'ws';
import { ServerMsgType } from '@twnr/shared';
import { sendEnvelope } from '../game-state.js';
import { pool } from '../db/index.js';

export async function handleJettison(ws: WebSocket, playerId: number): Promise<void> {
    const cargoRes = await pool.query(
        'SELECT fuel, organics, equipment, colonists FROM ship_cargo WHERE player_id = $1',
        [playerId],
    );
    if (cargoRes.rows.length === 0) {
        sendEnvelope(playerId, {
            type: ServerMsgType.JettisonResult,
            outcome: 'error',
            message: 'Player not found',
        });
        return;
    }

    const jettisoned = {
        fuel: cargoRes.rows[0].fuel,
        organics: cargoRes.rows[0].organics,
        equipment: cargoRes.rows[0].equipment,
        colonists: cargoRes.rows[0].colonists,
    };

    await pool.query(
        'UPDATE ship_cargo SET fuel = 0, organics = 0, equipment = 0, colonists = 0 WHERE player_id = $1',
        [playerId],
    );

    sendEnvelope(playerId, {
        type: ServerMsgType.JettisonResult,
        outcome: 'success',
        jettisoned,
    });
}

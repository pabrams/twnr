import { WebSocket } from 'ws';
import { ServerMsgType } from '@twnr/shared';
import { send } from '../game-state.js';
import { pool } from '../db/index.js';

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

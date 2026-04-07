import { ServerMsgType } from '@twnr/shared';
import { sendEnvelope, setPlayerMenu } from '../game-state.js';
import { pool } from '../db/index.js';

export async function handleJettison(playerId: number): Promise<void> {
    const cargoRes = await pool.query(
        'SELECT s.fuel, s.organics, s.equipment, s.colonists FROM players p JOIN ships s ON p.ship_id = s.id WHERE p.id = $1',
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
        'UPDATE ships SET fuel = 0, organics = 0, equipment = 0, colonists = 0 WHERE id = (SELECT ship_id FROM players WHERE id = $1)',
        [playerId],
    );

    await setPlayerMenu(playerId, 'sector');
    sendEnvelope(playerId, {
        type: ServerMsgType.JettisonResult,
        outcome: 'success',
        jettisoned,
    });
}

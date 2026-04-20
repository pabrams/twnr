import { ServerMsgType } from '@twnr/shared';
import { sendEnvelope, setPlayerMenu } from '../game-state.js';
import { getShipCargo, zeroShipCargo } from '../db/queries/ship.js';

export async function handleJettison(playerId: number): Promise<void> {
    const cargo = await getShipCargo(playerId);
    if (!cargo) {
        sendEnvelope(playerId, {
            type: ServerMsgType.JettisonResult,
            outcome: 'error',
            message: 'Player not found',
        });
        return;
    }

    await zeroShipCargo(playerId);

    await setPlayerMenu(playerId, 'sector');
    sendEnvelope(playerId, {
        type: ServerMsgType.JettisonResult,
        outcome: 'success',
        jettisoned: cargo,
    });
}

import { ServerMsgType } from '@twnr/shared';
import { sendEnvelope } from '../state/messaging.js';
import { getShipCargo, zeroShipCargo } from '../db/queries/ship.js';

export async function handleJettison(playerId: number): Promise<void> {
    const cargo = await getShipCargo(playerId);
    if (!cargo) {
        await sendEnvelope(
            playerId,
            { type: ServerMsgType.JettisonResult, outcome: 'error', message: 'Player not found' },
            'sector',
        );
        return;
    }

    await zeroShipCargo(playerId);

    await sendEnvelope(
        playerId,
        { type: ServerMsgType.JettisonResult, outcome: 'success', jettisoned: cargo },
        'sector',
    );
}

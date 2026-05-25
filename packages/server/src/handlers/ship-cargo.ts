import { ServerTag } from '@twnr/shared';
import { sendEnvelope } from '../state/messaging.js';
import { withTransaction } from '../db/index.js';
import { getShipCargo, zeroShipCargo } from '../db/queries/ship.js';
import {
    adjustReputationAndExperience,
    getPlayerReputationForUpdate,
    markFirstColosJettisonOfDay,
} from '../db/queries/player.js';
import { reputationDeltas, experienceDeltas, scalarDelta } from '../game-config.js';

export async function serveJettison(playerId: number): Promise<void> {
    const cargo = await getShipCargo(playerId);
    if (!cargo) {
        await sendEnvelope(playerId, {
            type: ServerTag.JettisonResult,
            outcome: 'error',
            message: 'Player not found',
        });
        return;
    }

    let appliedRep = 0;
    let appliedExp = 0;
    await withTransaction(async (client) => {
        await zeroShipCargo(playerId, client);

        // Blue-jettisons-colos penalty: only when colonists were actually
        // jettisoned, only for blue players (rep > 0), and only on the
        // first such jettison this UTC day.
        if (cargo.colonists > 0) {
            const rep = await getPlayerReputationForUpdate(playerId, client);
            if (rep > 0) {
                const isFirstToday = await markFirstColosJettisonOfDay(playerId, client);
                if (isFirstToday) {
                    const key = 'blueJettisonsColosOncePerDay';
                    appliedRep = scalarDelta(reputationDeltas, key);
                    appliedExp = scalarDelta(experienceDeltas, key);
                    await adjustReputationAndExperience(playerId, appliedRep, appliedExp, client);
                }
            }
        }
    });

    await sendEnvelope(playerId, {
        type: ServerTag.JettisonResult,
        outcome: 'success',
        jettisoned: cargo,
        expDelta: appliedExp,
        repDelta: appliedRep,
    });
}

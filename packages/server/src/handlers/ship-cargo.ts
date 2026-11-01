import { withTransaction } from '../db/index.js';
import { getShipCargo, zeroShipCargo } from '../db/queries/ship.js';
import {
    adjustReputationAndExperience,
    getPlayerReputationForUpdate,
    markFirstColosJettisonOfDay,
} from '../db/queries/player.js';
import { reputationDeltas, experienceDeltas, scalarDelta } from '../game-config.js';
import { type CommandResult } from './command.js';

export async function serveJettison(playerId: number): Promise<CommandResult<'Jettison'>> {
    const cargo = await getShipCargo(playerId);
    if (!cargo) {
        throw new Error('Player not found');
    }

    let appliedRep = 0;
    let appliedExp = 0;
    await withTransaction(async (client) => {
        await zeroShipCargo(playerId, client);

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

    return {
        outcome: 'success',
        jettisoned: cargo,
        expDelta: appliedExp,
        repDelta: appliedRep,
    };
}

import { ServerMsgType } from '@twnr/shared';
import type { ServerResult } from '@twnr/shared';

import { players, sendEnvelope, setPlayerMenu } from '../game-state.js';
import { withTransaction, AbortTransaction } from '../db/index.js';
import {
    getShipDronesForUpdate,
    getShipDronesAndShieldsForUpdate,
    setShipDrones,
    setShipDronesAndShields,
    deleteShipByOwner,
    markPlayerShipDestroyed,
} from '../db/queries/ship.js';

export async function handleAttackShip(
    attackerId: number,
    targetPlayerId: number,
    drones: number,
): Promise<void> {
    if (!Number.isInteger(drones) || drones <= 0) {
        sendEnvelope(attackerId, {
            type: ServerMsgType.Error,
            message: 'Invalid number of drones',
        });
        return;
    }

    if (attackerId === targetPlayerId) {
        sendEnvelope(attackerId, {
            type: ServerMsgType.Error,
            message: 'You cannot attack yourself',
        });
        return;
    }

    const attacker = players[attackerId];
    const target = players[targetPlayerId];

    if (
        !attacker ||
        !target ||
        attacker.sector !== target.sector ||
        attacker.universeId !== target.universeId
    ) {
        sendEnvelope(attackerId, {
            type: ServerMsgType.Error,
            message: 'Target is not in this sector',
        });
        return;
    }

    if (target.docked) {
        sendEnvelope(attackerId, {
            type: ServerMsgType.Error,
            message: 'Target is docked at a port',
        });
        return;
    }

    try {
        const result = await withTransaction(async (client) => {
            const attackerDrones = await getShipDronesForUpdate(attackerId, client);
            const targetShip = await getShipDronesAndShieldsForUpdate(targetPlayerId, client);

            if (attackerDrones === undefined || targetShip === undefined) {
                sendEnvelope(attackerId, { type: ServerMsgType.Error, message: 'Ship not found' });
                throw new AbortTransaction();
            }

            if (drones > attackerDrones) {
                sendEnvelope(attackerId, {
                    type: ServerMsgType.Error,
                    message: 'Not enough drones',
                });
                throw new AbortTransaction();
            }

            let targetShields = targetShip.shields;
            let targetDrones = targetShip.drones;
            let remainingAttack = drones;

            const shieldsLost = Math.min(targetShields, remainingAttack);
            targetShields -= shieldsLost;
            remainingAttack -= shieldsLost;

            let defenderDronesLost = 0;
            if (remainingAttack > 0) {
                defenderDronesLost = Math.min(targetDrones, remainingAttack);
                targetDrones -= defenderDronesLost;
                remainingAttack -= defenderDronesLost;
            }

            const destroyed = remainingAttack > 0;
            const attackerDronesLost = shieldsLost + defenderDronesLost;

            await setShipDrones(attackerId, attackerDrones - attackerDronesLost, client);

            if (destroyed) {
                await deleteShipByOwner(targetPlayerId, client);
                await markPlayerShipDestroyed(targetPlayerId, client);
            } else {
                await setShipDronesAndShields(targetPlayerId, targetDrones, targetShields, client);
            }

            return { destroyed, attackerDronesLost, defenderDronesLost, shieldsLost };
        });

        if (!result) return;

        const { destroyed, attackerDronesLost, defenderDronesLost, shieldsLost } = result;

        await setPlayerMenu(attackerId, 'sector');
        const resultMsg: ServerResult = {
            type: ServerMsgType.AttackShipResult,
            destroyed,
            attackerDronesLost,
            defenderDronesLost,
            defenderShieldsLost: shieldsLost,
            message: destroyed ? 'Target destroyed!' : 'Attack completed.',
        };
        sendEnvelope(attackerId, resultMsg);

        if (target.ws && target.ws.readyState === 1) {
            sendEnvelope(targetPlayerId, {
                type: ServerMsgType.AttackShipResult,
                destroyed,
                attackerDronesLost,
                defenderDronesLost,
                defenderShieldsLost: shieldsLost,
                message: destroyed ? 'Your ship was destroyed!' : 'You were attacked!',
            });
            if (destroyed) {
                target.ws.close(1008, 'Ship destroyed');
            }
        }
    } catch (e) {
        console.error('Attack error', e);
        sendEnvelope(attackerId, { type: ServerMsgType.Error, message: 'Internal server error' });
    }
}

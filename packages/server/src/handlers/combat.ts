import { ServerMsgType } from '@twnr/shared';
import type { ServerResult } from '@twnr/shared';

import { players, sendEnvelope, setPlayerMenu } from '../game-state.js';
import { pool } from '../db/index.js';
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

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const attackerDrones = await getShipDronesForUpdate(attackerId, client);
        const targetShip = await getShipDronesAndShieldsForUpdate(targetPlayerId, client);

        if (attackerDrones === undefined || targetShip === undefined) {
            await client.query('ROLLBACK');
            sendEnvelope(attackerId, { type: ServerMsgType.Error, message: 'Ship not found' });
            return;
        }

        let targetShields = targetShip.shields;
        let targetDrones = targetShip.drones;

        if (drones > attackerDrones) {
            await client.query('ROLLBACK');
            sendEnvelope(attackerId, { type: ServerMsgType.Error, message: 'Not enough drones' });
            return;
        }

        let remainingAttack = drones;
        let shieldsLost = 0;
        let defenderDronesLost = 0;

        const shieldAbsorb = Math.min(targetShields, remainingAttack);
        shieldsLost = shieldAbsorb;
        targetShields -= shieldAbsorb;
        remainingAttack -= shieldAbsorb;

        if (remainingAttack > 0) {
            const droneAbsorb = Math.min(targetDrones, remainingAttack);
            defenderDronesLost = droneAbsorb;
            targetDrones -= droneAbsorb;
            remainingAttack -= droneAbsorb;
        }

        const destroyed = remainingAttack > 0;
        const attackerDronesLost = shieldsLost + defenderDronesLost;
        const newAttackerDrones = attackerDrones - attackerDronesLost;

        await setShipDrones(attackerId, newAttackerDrones, client);

        if (destroyed) {
            await deleteShipByOwner(targetPlayerId, client);
            await markPlayerShipDestroyed(targetPlayerId, client);
        } else {
            await setShipDronesAndShields(targetPlayerId, targetDrones, targetShields, client);
        }

        await client.query('COMMIT');

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
        await client.query('ROLLBACK');
        console.error('Attack error', e);
        sendEnvelope(attackerId, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
    }
}

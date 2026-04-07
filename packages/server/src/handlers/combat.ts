import { ServerMsgType } from '@twnr/shared';
import type { ServerResult } from '@twnr/shared';

import { players, sendEnvelope, setPlayerMenu } from '../game-state.js';
import { pool } from '../db/index.js';

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

        const attackerShipRes = await client.query(
            'SELECT drones FROM ships WHERE id = (SELECT ship_id FROM players WHERE id = $1) FOR UPDATE',
            [attackerId],
        );
        const targetShipRes = await client.query(
            'SELECT drones, shields FROM ships WHERE id = (SELECT ship_id FROM players WHERE id = $1) FOR UPDATE',
            [targetPlayerId],
        );

        if (attackerShipRes.rows.length === 0 || targetShipRes.rows.length === 0) {
            await client.query('ROLLBACK');
            sendEnvelope(attackerId, { type: ServerMsgType.Error, message: 'Ship not found' });
            return;
        }

        const attackerDrones = attackerShipRes.rows[0].drones;
        let targetShields = targetShipRes.rows[0].shields;
        let targetDrones = targetShipRes.rows[0].drones;

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

        await client.query('UPDATE ships SET drones = $1 WHERE id = (SELECT ship_id FROM players WHERE id = $2)', [
            newAttackerDrones,
            attackerId,
        ]);

        if (destroyed) {
            await client.query('DELETE FROM ships WHERE owner_id = $1', [targetPlayerId]);
            await client.query('UPDATE players SET ship_id = NULL, ship_destroyed_date = NOW() WHERE id = $1', [
                targetPlayerId,
            ]);
        } else {
            await client.query(
                'UPDATE ships SET drones = $1, shields = $2 WHERE id = (SELECT ship_id FROM players WHERE id = $3)',
                [targetDrones, targetShields, targetPlayerId],
            );
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

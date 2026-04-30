import { ServerMsgType } from '@twnr/shared';
import type { ServerResult } from '@twnr/shared';

import { players } from '../state/players.js';
import { sendEnvelope, sendError } from '../state/messaging.js';
import { withTransaction, AbortTransaction } from '../db/index.js';
import {
    getShipDronesForUpdate,
    getShipDronesAndShieldsForUpdate,
    setShipDrones,
    setShipDronesAndShields,
    deleteShipByOwner,
    markPlayerShipDestroyed,
} from '../db/queries/ship.js';

/**
 * Player pressed 'A' in the sector menu. Returns the attack roster for the
 * current sector; transitions to the Attack menu if there are targets,
 * otherwise leaves the player at the Sector menu.
 */
export async function handleAttack(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const roster: { id: number; name: string }[] = [];
    for (const [idStr, p] of Object.entries(players)) {
        const pid = Number(idStr);
        if (pid === playerId) continue;
        if (p.universeId !== player.universeId) continue;
        if (p.sector !== player.sector) continue;
        if (p.docked) continue;
        roster.push({ id: pid, name: p.name });
    }

    await sendEnvelope(
        playerId,
        { type: ServerMsgType.AttackMenuResult, players: roster },
        roster.length > 0 ? 'attack' : 'sector',
    );
}

export async function handleAttackShip(
    attackerId: number,
    targetPlayerId: number,
    drones: number,
): Promise<void> {
    if (!Number.isInteger(drones) || drones <= 0) {
        sendError(attackerId, 'Invalid number of drones');
        return;
    }

    if (attackerId === targetPlayerId) {
        sendError(attackerId, 'You cannot attack yourself');
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
        sendError(attackerId, 'Target is not in this sector');
        return;
    }

    if (target.docked) {
        sendError(attackerId, 'Target is docked at a port');
        return;
    }

    try {
        const result = await withTransaction(async (client) => {
            const attackerDrones = await getShipDronesForUpdate(attackerId, client);
            const targetShip = await getShipDronesAndShieldsForUpdate(targetPlayerId, client);

            if (attackerDrones === undefined || targetShip === undefined) {
                sendError(attackerId, 'Ship not found');
                throw new AbortTransaction();
            }

            if (drones > attackerDrones) {
                sendError(attackerId, 'Not enough drones');
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

        const resultMsg: ServerResult = {
            type: ServerMsgType.AttackShipResult,
            destroyed,
            attackerDronesLost,
            defenderDronesLost,
            defenderShieldsLost: shieldsLost,
            message: destroyed ? 'Target destroyed!' : 'Attack completed.',
        };
        await sendEnvelope(attackerId, resultMsg, 'sector');

        if (target.ws && target.ws.readyState === 1) {
            await sendEnvelope(targetPlayerId, {
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
        sendError(attackerId, 'Internal server error');
    }
}

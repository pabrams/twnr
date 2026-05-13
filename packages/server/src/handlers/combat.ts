import { ServerTag } from '@twnr/shared';
import type { ServerEnvelope, AttackShipCommand } from '@twnr/shared';

import { players, isVisibleInSector } from '../state/players.js';
import { sendEnvelope, sendError, closeDestroyedSession } from '../state/messaging.js';
import { withTransaction, AbortTransaction } from '../db/index.js';
import {
    getShipDronesForUpdate,
    getShipDronesAndShieldsForUpdate,
    setShipDrones,
    setShipDronesAndShields,
    destroyShipRecord,
} from '../db/queries/ship.js';
import { listPlayersInSector, getAttackTargetInfo } from '../db/queries/player.js';
import { getSectorBeacon } from '../db/queries/beacons.js';

export async function serveGetAttackTargets(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const rows = await listPlayersInSector(player.sector, player.universeId, playerId);
    const roster = rows
        .filter((row) => isVisibleInSector(row.id, row.docked, row.on_planet_id))
        .map((row) => ({ id: row.id, name: row.name }));

    const beacon = await getSectorBeacon(player.sectorId);

    await sendEnvelope(playerId, {
        type: ServerTag.GetAttackTargetsResult,
        players: roster,
        beaconPresent: !!beacon,
    });
}

export async function serveAttackShip(
    attackerId: number,
    data: AttackShipCommand,
): Promise<void> {
    const { targetPlayerId, drones } = data;
    if (!Number.isInteger(drones) || drones <= 0) {
        sendError(attackerId, 'Invalid number of drones');
        return;
    }

    if (attackerId === targetPlayerId) {
        sendError(attackerId, 'You cannot attack yourself');
        return;
    }

    const attacker = players[attackerId];
    if (!attacker) {
        sendError(attackerId, 'Target is not in this sector');
        return;
    }

    const targetInfo = await getAttackTargetInfo(targetPlayerId);
    if (
        !targetInfo ||
        targetInfo.universe_id !== attacker.universeId ||
        targetInfo.sector_number !== attacker.sector ||
        !isVisibleInSector(targetPlayerId, targetInfo.docked, targetInfo.on_planet_id)
    ) {
        sendError(attackerId, 'Target is not in this sector');
        return;
    }

    const onlineTarget = players[targetPlayerId];

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
                await destroyShipRecord(targetPlayerId, client);
            } else {
                await setShipDronesAndShields(targetPlayerId, targetDrones, targetShields, client);
            }

            return { destroyed, attackerDronesLost, defenderDronesLost, shieldsLost };
        });

        if (!result) return;

        const { destroyed, attackerDronesLost, defenderDronesLost, shieldsLost } = result;

        const resultMsg: ServerEnvelope = {
            type: ServerTag.AttackShipResult,
            destroyed,
            attackerDronesLost,
            defenderDronesLost,
            defenderShieldsLost: shieldsLost,
            message: destroyed ? 'Target destroyed!' : 'Attack completed.',
        };
        await sendEnvelope(attackerId, resultMsg);

        if (onlineTarget?.ws && onlineTarget.ws.readyState === 1) {
            await sendEnvelope(targetPlayerId, {
                type: ServerTag.AttackShipResult,
                destroyed,
                attackerDronesLost,
                defenderDronesLost,
                defenderShieldsLost: shieldsLost,
                message: destroyed ? 'Your ship was destroyed!' : 'You were attacked!',
            });
            if (destroyed) {
                closeDestroyedSession(targetPlayerId, 'Ship destroyed');
            }
        }
    } catch (e) {
        console.error('Attack error', e);
        sendError(attackerId, 'Internal server error');
    }
}

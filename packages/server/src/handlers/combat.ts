import { ServerTag } from '@twnr/shared';
import type { AttackShipCommand } from '@twnr/shared';

import { onlinePlayers, isVisibleInSector } from '../state/players.js';
import {
    sendEnvelope,
    sendError,
    closeDestroyedSession,
    broadcastEnvelope,
} from '../state/messaging.js';
import { AbortTransaction } from '../db/index.js';
import { runMutation } from './run-mutation.js';
import {
    getShipDronesForUpdate,
    getShipDronesAndShieldsForUpdate,
    setShipDrones,
    setShipDronesAndShields,
    destroyShipRecord,
} from '../db/queries/ship.js';
import {
    adjustReputationAndExperience,
    getAttackTargetInfo,
    getPlayerRepExpForUpdate,
    listPlayersInSector,
} from '../db/queries/player.js';
import { getSectorBeacon } from '../db/queries/beacons.js';
import {
    pvpAttackerDeltas,
    pvpMatchup,
    shipDestroyAttackerBonus,
    shipDestroyDefenderPenalty,
} from '../services/combat-rewards.js';

export async function serveGetAttackTargets(playerId: number): Promise<void> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    const rows = await listPlayersInSector(player.sector, player.universeId, playerId);
    const visible = rows.filter((row) => isVisibleInSector(row.id, row.docked, row.on_planet_id));
    const roster = visible.map((row) => ({ id: row.id, name: row.name }));

    const beacon = await getSectorBeacon(player.sectorId);

    await sendEnvelope(playerId, {
        type: ServerTag.GetAttackTargetsResult,
        players: roster,
        beaconPresent: !!beacon,
    });

    // Warn everyone else in the sector that the attacker is about to fire.
    if (visible.length > 0) {
        broadcastEnvelope(
            {
                type: ServerTag.Notice,
                senderLabel: null,
                body: `[br]${player.name} is powering up their weapon systems![/br]`,
            },
            visible.map((row) => row.id),
        );
    }
}

export async function serveAttackShip(attackerId: number, data: AttackShipCommand): Promise<void> {
    const { targetPlayerId, drones } = data;
    if (!Number.isInteger(drones) || drones <= 0) {
        sendError(attackerId, 'Invalid number of drones');
        return;
    }

    if (attackerId === targetPlayerId) {
        sendError(attackerId, 'You cannot attack yourself');
        return;
    }

    const attacker = onlinePlayers[attackerId];
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

    const onlineTarget = onlinePlayers[targetPlayerId];

    await runMutation(
        attackerId,
        'Attack',
        async (client) => {
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

            // Combat rewards: attacker gains exp/rep based on the drones it
            // lost and the defender's pre-penalty rep. On destroy the
            // attacker gets a bonus from the defender's PRE-penalty snapshot
            // and the defender takes a self-percentage penalty. Defender
            // accrues nothing unless destroyed.
            const attackerSnap = await getPlayerRepExpForUpdate(attackerId, client);
            const defenderSnap = await getPlayerRepExpForUpdate(targetPlayerId, client);
            const matchup = pvpMatchup(attackerSnap.reputation, defenderSnap.reputation);

            const combat = pvpAttackerDeltas({
                attackerDronesLost,
                defenderRep: defenderSnap.reputation,
                matchup,
            });
            let attackerExpDelta = combat.experienceDelta;
            let attackerRepDelta = combat.reputationDelta;
            let defenderExpDelta = 0;
            let defenderRepDelta = 0;

            if (destroyed) {
                const bonus = shipDestroyAttackerBonus({
                    defenderRepBefore: defenderSnap.reputation,
                    defenderExpBefore: defenderSnap.experience,
                });
                attackerExpDelta += bonus.experienceDelta;
                attackerRepDelta += bonus.reputationDelta;

                const penalty = shipDestroyDefenderPenalty({
                    defenderRepBefore: defenderSnap.reputation,
                    defenderExpBefore: defenderSnap.experience,
                });
                defenderExpDelta = penalty.experienceDelta;
                defenderRepDelta = penalty.reputationDelta;
                if (penalty.experienceDelta !== 0 || penalty.reputationDelta !== 0) {
                    await adjustReputationAndExperience(
                        targetPlayerId,
                        penalty.reputationDelta,
                        penalty.experienceDelta,
                        client,
                    );
                }
            }
            if (attackerExpDelta !== 0 || attackerRepDelta !== 0) {
                await adjustReputationAndExperience(
                    attackerId,
                    attackerRepDelta,
                    attackerExpDelta,
                    client,
                );
            }

            return {
                destroyed,
                attackerDronesLost,
                defenderDronesLost,
                shieldsLost,
                attackerExpDelta,
                attackerRepDelta,
                defenderExpDelta,
                defenderRepDelta,
            };
        },
        async (result) => {
            const { destroyed, attackerDronesLost, defenderDronesLost, shieldsLost } = result;

            sendEnvelope(attackerId, {
                type: ServerTag.AttackShipResult,
                destroyed,
                attackerDronesLost,
                defenderDronesLost,
                defenderShieldsLost: shieldsLost,
                message: destroyed ? 'Target destroyed!' : 'Attack completed.',
                expDelta: result.attackerExpDelta,
                repDelta: result.attackerRepDelta,
            });

            if (onlineTarget?.ws && onlineTarget.ws.readyState === 1) {
                sendEnvelope(targetPlayerId, {
                    type: ServerTag.AttackShipResult,
                    destroyed,
                    attackerDronesLost,
                    defenderDronesLost,
                    defenderShieldsLost: shieldsLost,
                    message: destroyed ? 'Your ship was destroyed!' : 'You were attacked!',
                    expDelta: result.defenderExpDelta,
                    repDelta: result.defenderRepDelta,
                });
                if (destroyed) {
                    closeDestroyedSession(targetPlayerId, 'Ship destroyed');
                }
            }
        },
    );
}

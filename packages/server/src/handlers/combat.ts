import { Events } from '@twnr/shared';
import type { CommandRequest } from '@twnr/shared';

import { onlinePlayers, isVisibleInSector, requireOnlinePlayer } from '../state/players.js';
import { sendEnvelope, closeDestroyedSession, broadcastEnvelope } from '../state/messaging.js';

import {
    getShipDronesForUpdate,
    getShipDefensesForUpdate,
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
import { recordGameEvent } from '../services/game-events.js';
import { type CommandResult, commandRefusal, mutateAndReply } from './command.js';

export async function serveAttackTargets(
    playerId: number,
): Promise<CommandResult<'AttackTargets'>> {
    const player = requireOnlinePlayer(playerId);

    const rows = await listPlayersInSector(player.sector, player.universeId, playerId);
    const visible = rows.filter((row) => isVisibleInSector(row.id, row.docked, row.on_planet_id));
    const roster = visible.map((row) => ({ id: row.id, name: row.name }));

    const beacon = await getSectorBeacon(player.sectorId);

    if (visible.length > 0) {
        broadcastEnvelope(
            {
                type: Events.Notice.name,
                senderLabel: null,
                body: `[br]${player.name} is powering up their weapon systems![/br]`,
            },
            visible.map((row) => row.id),
        );
    }

    return { outcome: 'ok', players: roster, beaconPresent: !!beacon };
}

export async function serveAttackShip(
    attackerId: number,
    data: CommandRequest<'AttackShip'>,
): Promise<CommandResult<'AttackShip'>> {
    const { targetPlayerId, drones } = data;

    if (attackerId === targetPlayerId) {
        return commandRefusal('cannotAttackSelf');
    }

    const attacker = onlinePlayers[attackerId];
    if (!attacker) {
        return commandRefusal('targetNotHere');
    }

    const targetInfo = await getAttackTargetInfo(targetPlayerId);
    if (
        !targetInfo ||
        targetInfo.universe_id !== attacker.universeId ||
        targetInfo.sector_number !== attacker.sector ||
        !isVisibleInSector(targetPlayerId, targetInfo.docked, targetInfo.on_planet_id)
    ) {
        return commandRefusal('targetNotHere');
    }

    const onlineTarget = onlinePlayers[targetPlayerId];

    return mutateAndReply(
        async (client, abort) => {
            const attackerDrones = await getShipDronesForUpdate(attackerId, client);
            const targetShip = await getShipDefensesForUpdate(targetPlayerId, client);

            if (attackerDrones === undefined) throw abort(commandRefusal('noShip'));
            if (targetShip === undefined) throw abort(commandRefusal('targetHasNoShip'));

            if (drones > attackerDrones) {
                throw abort(commandRefusal('notEnoughDrones'));
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
                await recordGameEvent(
                    attacker.universeId,
                    {
                        kind: 'player_ship_destroyed_by_ship_combat',
                        attacker: { playerId: attackerId, name: attacker.name },
                        victim: { playerId: targetPlayerId, name: targetInfo.name },
                        destroyedShipType: {
                            slug: targetShip.ship_type_slug,
                            displayName: targetShip.ship_display_name,
                        },
                        sectorNumber: attacker.sector,
                    },
                    client,
                );
            } else {
                await setShipDronesAndShields(targetPlayerId, targetDrones, targetShields, client);
            }

            // Rewards use the defender's pre-penalty rep/exp snapshot.
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
        (result) => {
            const { destroyed, attackerDronesLost, defenderDronesLost, shieldsLost } = result;

            if (onlineTarget?.ws && onlineTarget.ws.readyState === 1) {
                sendEnvelope(targetPlayerId, {
                    type: Events.ShipAttacked.name,
                    attackerName: attacker.name,
                    destroyed,
                    attackerDronesLost,
                    defenderDronesLost,
                    defenderShieldsLost: shieldsLost,
                    expDelta: result.defenderExpDelta,
                    repDelta: result.defenderRepDelta,
                });
                if (destroyed) {
                    closeDestroyedSession(targetPlayerId, 'Ship destroyed');
                }
            }

            return {
                outcome: 'ok',
                destroyed,
                attackerDronesLost,
                defenderDronesLost,
                defenderShieldsLost: shieldsLost,
                expDelta: result.attackerExpDelta,
                repDelta: result.attackerRepDelta,
            };
        },
    );
}

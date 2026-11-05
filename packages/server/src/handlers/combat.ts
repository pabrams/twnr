import { Events } from '@twnr/shared';
import type { CommandRequest, Refusal } from '@twnr/shared';

import { isVisibleInSector, requireOnlinePlayer } from '../state/players.js';
import { sendEnvelope, closeDestroyedSession } from '../state/messaging.js';

import {
    getShipDrones,
    getShipDronesForUpdate,
    getShipMaxDroneAttack,
    getShipDefensesForUpdate,
    setShipDrones,
    setShipDronesAndShields,
    destroyShipRecord,
} from '../db/queries/ship.js';
import {
    type AttackTargetRow,
    adjustReputationAndExperience,
    getAttackTargetInfo,
    getOnPlanetId,
    getPlayerRepExpForUpdate,
    getPlayerShipId,
    listPlayersInSector,
} from '../db/queries/player.js';
import { insertMemo } from '../db/queries/message.js';
import { getSectorBeacon } from '../db/queries/beacons.js';
import {
    pvpAttackerDeltas,
    pvpMatchup,
    shipDestroyAttackerBonus,
    shipDestroyDefenderPenalty,
} from '../services/combat-rewards.js';
import { recordGameEvent } from '../services/game-events.js';
import { isInEncounter } from '../services/encounter.js';
import { broadcastToSectorObservers } from '../services/sector-activity.js';
import { sendStatsSnapshot } from '../services/stats-snapshot.js';
import { type CommandResult, commandRefusal, mutateAndReply } from './command.js';

function defenderAttackMemo(
    attackerName: string,
    sector: number,
    destroyed: boolean,
    shieldsLost: number,
    dronesLost: number,
): string {
    if (destroyed) return `${attackerName} destroyed your ship in sector ${sector}.`;
    const prefix = `${attackerName} attacked your ship in sector ${sector}.`;
    if (shieldsLost > 0 && dronesLost > 0) {
        return `${prefix} You lost ${shieldsLost} shield(s) and ${dronesLost} drone(s).`;
    }
    if (shieldsLost > 0) return `${prefix} You lost ${shieldsLost} shield(s).`;
    return `${prefix} You lost ${dronesLost} drone(s).`;
}

async function findAttackerRefusal(playerId: number): Promise<Refusal | null> {
    const player = requireOnlinePlayer(playerId);
    if (player.docked || player.at_starbase) return commandRefusal('docked');
    if (isInEncounter(playerId)) return commandRefusal('inEncounter');
    if ((await getOnPlanetId(playerId)) !== null) return commandRefusal('onPlanet');
    if ((await getPlayerShipId(playerId)) === null) return commandRefusal('noShip');
    return null;
}

async function validateAttack(
    attackerId: number,
    targetPlayerId: number,
): Promise<AttackTargetRow | Refusal> {
    const refusal = await findAttackerRefusal(attackerId);
    if (refusal) return refusal;

    if (attackerId === targetPlayerId) {
        return commandRefusal('cannotAttackSelf');
    }

    const attacker = requireOnlinePlayer(attackerId);
    const targetInfo = await getAttackTargetInfo(targetPlayerId);
    if (
        !targetInfo ||
        targetInfo.universe_id !== attacker.universeId ||
        targetInfo.sector_number !== attacker.sector ||
        !isVisibleInSector(targetPlayerId, targetInfo.docked, targetInfo.on_planet_id)
    ) {
        return commandRefusal('targetNotHere');
    }
    return targetInfo;
}

export async function serveAttackTargets(
    playerId: number,
): Promise<CommandResult<'AttackTargets'>> {
    const player = requireOnlinePlayer(playerId);

    const refusal = await findAttackerRefusal(playerId);
    if (refusal) return refusal;

    const rows = await listPlayersInSector(player.sector, player.universeId, playerId);
    const visible = rows.filter((row) => isVisibleInSector(row.id, row.docked, row.on_planet_id));
    const beacon = await getSectorBeacon(player.sectorId);

    return {
        outcome: 'ok',
        players: visible.map((row) => ({
            id: row.id,
            name: row.name,
            shipTypeName: row.ship_type_name ?? '',
            shipTypeDisplayName: row.ship_display_name,
            drones: row.ship_drones,
        })),
        shipDrones: (await getShipDrones(playerId)) ?? 0,
        beaconPresent: !!beacon,
    };
}

export async function servePowerUpWeapons(
    attackerId: number,
    data: CommandRequest<'PowerUpWeapons'>,
): Promise<CommandResult<'PowerUpWeapons'>> {
    const target = await validateAttack(attackerId, data.targetPlayerId);
    if ('outcome' in target) return target;

    const [shipDrones, maxDroneAttack] = await Promise.all([
        getShipDrones(attackerId),
        getShipMaxDroneAttack(attackerId),
    ]);
    const maxWaveDrones = Math.min(shipDrones ?? 0, maxDroneAttack);
    if (maxWaveDrones === 0) return commandRefusal('noDronesToLaunch');

    const attacker = requireOnlinePlayer(attackerId);
    void broadcastToSectorObservers(attackerId, {
        type: Events.WeaponsPoweringUp.name,
        attackerName: attacker.name,
    });
    return { outcome: 'ok', maxWaveDrones };
}

export async function serveAttackShip(
    attackerId: number,
    data: CommandRequest<'AttackShip'>,
): Promise<CommandResult<'AttackShip'>> {
    const { targetPlayerId, drones } = data;

    const targetInfo = await validateAttack(attackerId, targetPlayerId);
    if ('outcome' in targetInfo) return targetInfo;

    const attacker = requireOnlinePlayer(attackerId);

    return mutateAndReply(
        async (client, abort) => {
            const attackerDrones = await getShipDronesForUpdate(attackerId, client);
            const targetShip = await getShipDefensesForUpdate(targetPlayerId, client);

            if (attackerDrones === undefined) throw abort(commandRefusal('noShip'));
            if (targetShip === undefined) throw abort(commandRefusal('targetHasNoShip'));

            if (drones > attackerDrones) {
                throw abort(commandRefusal('notEnoughDrones'));
            }
            const maxDroneAttack = await getShipMaxDroneAttack(attackerId, client);
            if (drones > maxDroneAttack) {
                throw abort(commandRefusal('exceedsMaxDroneAttack', { max: maxDroneAttack }));
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

            if (destroyed || shieldsLost > 0 || defenderDronesLost > 0) {
                await insertMemo(
                    targetPlayerId,
                    attackerId,
                    null,
                    destroyed ? 'ship_destroyed' : 'ship_attacked',
                    defenderAttackMemo(
                        attacker.name,
                        attacker.sector,
                        destroyed,
                        shieldsLost,
                        defenderDronesLost,
                    ),
                    client,
                );
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
                attackerDronesRemaining: attackerDrones - attackerDronesLost,
                defenderDronesLost,
                defenderDronesRemaining: destroyed ? 0 : targetDrones,
                shieldsLost,
                attackerExpDelta,
                attackerRepDelta,
                defenderExpDelta,
                defenderRepDelta,
            };
        },
        (result) => {
            const { destroyed, attackerDronesLost, defenderDronesLost, shieldsLost } = result;
            const defenderChanged = destroyed || shieldsLost > 0 || defenderDronesLost > 0;

            if (defenderChanged) {
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
            }
            if (destroyed) {
                closeDestroyedSession(targetPlayerId, 'Ship destroyed');
            } else if (defenderChanged) {
                sendStatsSnapshot(targetPlayerId).catch((err) =>
                    console.error('Stats snapshot error:', err),
                );
            }

            void broadcastToSectorObservers(
                attackerId,
                {
                    type: Events.DroneWaveLaunched.name,
                    attackerName: attacker.name,
                    defenderName: targetInfo.name,
                },
                [targetPlayerId],
            );

            return {
                outcome: 'ok',
                destroyed,
                attackerDronesLost,
                attackerDronesRemaining: result.attackerDronesRemaining,
                defenderDronesLost,
                defenderDronesRemaining: result.defenderDronesRemaining,
                expDelta: result.attackerExpDelta,
                repDelta: result.attackerRepDelta,
            };
        },
    );
}

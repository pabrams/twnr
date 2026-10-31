import { ServerTag } from '@twnr/shared';
import type { CommandRequest } from '@twnr/shared';
import { onlinePlayers } from '../state/players.js';
import { sendEnvelope } from '../state/messaging.js';
import { broadcastPlayerMoved } from '../services/sector-activity.js';
import { getSectorDrones, resolveSectorId } from '../services/sector-lookup.js';
import { buildSectorDisplayData } from '../services/sector-display.js';
import { isInEncounter } from '../services/encounter.js';

import {
    adjustReputationAndExperience,
    getPlayerRepExpForUpdate,
    getPlayerReputationForUpdate,
    getPreviousSectorNumber,
    moveToSector,
} from '../db/queries/player.js';
import {
    moveShipToSector,
    setShipDrones,
    getShipDronesAndMaxInfo,
    getShipDronesAndMaxForUpdate,
    getShipDronesForUpdate,
} from '../db/queries/ship.js';
import { getSectorDbId } from '../db/queries/sector.js';
import {
    getSectorDronesRowForUpdate,
    updateSectorDroneQuantity,
    updateSectorDroneOwnerAndQuantity,
    insertSectorDrones,
    deleteSectorDrones,
    getDeployedDronesByOwner,
} from '../db/queries/drones.js';
import { resolveMinesOnEntry } from '../services/mine-encounter.js';
import { refreshSectorObservation } from '../services/sector-observations.js';
import { getPlayerClanId, getClanMembers, getClanTotalReputation } from '../db/queries/clan.js';
import { pvfigsAttackerDeltas, pvfigsMatchup } from '../services/combat-rewards.js';
import { formatOwner, ownershipFrom } from '../services/owner-format.js';
import { type CommandResult, commandError, abort, runMutation } from './command.js';

export async function serveListDeployedDrones(
    playerId: number,
): Promise<CommandResult<'ListDeployedDrones'>> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    if (player.docked || player.at_starbase) {
        return commandError('Cannot use this command while docked');
    }

    const rows = await getDeployedDronesByOwner(playerId);
    return {
        drones: rows.map((r) => ({
            sectorId: r.sector_id,
            quantity: r.quantity,
            ownerLabel: formatOwner(r),
            ownership: ownershipFrom(r),
        })),
    };
}

export async function serveDeployDronesInfo(
    playerId: number,
): Promise<CommandResult<'DeployDronesInfo'>> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    if (player.docked) {
        return commandError('Cannot deploy while docked');
    }

    if (await isInEncounter(playerId)) {
        return commandError('Resolve drone encounter first');
    }

    const shipInfo = await getShipDronesAndMaxInfo(playerId);
    if (!shipInfo) return { outcome: 'noShip' };
    const sectorDrones = await getSectorDrones(player.sector, player.universeId);

    if (sectorDrones && sectorDrones.ownerId !== playerId) {
        return commandError('Sector contains hostile drones');
    }

    return {
        outcome: 'ok',
        sectorDrones: sectorDrones?.quantity ?? 0,
        shipDrones: shipInfo.drones,
        shipMaxDrones: shipInfo.max_drones ?? 0,
    };
}

export async function serveDeployDrones(
    playerId: number,
    data: CommandRequest<'DeployDrones'>,
): Promise<CommandResult<'DeployDrones'>> {
    let target = data.quantity;
    const ownership: 'personal' | 'clan' = data.ownership ?? 'personal';
    if (!Number.isInteger(target) || target < -1) {
        return commandError('Invalid target quantity');
    }

    const player = onlinePlayers[playerId];
    if (!player) return;

    if (player.docked) {
        return commandError('Cannot deploy while docked');
    }

    if (await isInEncounter(playerId)) {
        return commandError('Resolve drone encounter first');
    }

    const sectorId = player.sector;
    const universeId = player.universeId;

    const playerClanId = await getPlayerClanId(playerId);
    if (ownership === 'clan' && playerClanId === null) {
        return commandError('You are not in a clan.');
    }

    const deploySectorDbId = await getSectorDbId(sectorId, universeId);
    if (!deploySectorDbId) {
        return commandError('Sector not found');
    }

    return runMutation(
        'Deploy drones',
        async (client) => {
            const shipInfo = await getShipDronesAndMaxForUpdate(playerId, client);
            if (!shipInfo) throw abort({ outcome: 'noShip' });

            const shipDrones = shipInfo.drones;
            const maxDrones = shipInfo.max_drones ?? 0;

            const sectorDbId = deploySectorDbId;

            const existing = await getSectorDronesRowForUpdate(sectorDbId, client);

            let currentInSector = 0;
            let ownershipConverting = false;
            if (existing) {
                const friendly =
                    existing.owner_player_id === playerId ||
                    (playerClanId !== null && existing.owner_clan_id === playerClanId);
                if (!friendly) {
                    throw abort(commandError('Sector contains hostile drones'));
                }
                const matchesDeploy =
                    (ownership === 'personal' && existing.owner_player_id === playerId) ||
                    (ownership === 'clan' && existing.owner_clan_id === playerClanId);
                ownershipConverting = !matchesDeploy;
                currentInSector = existing.quantity;
            }

            // -1 = accept default: leave the minimum required so ship is filled to max.
            if (target === -1) {
                target = Math.max(0, shipDrones + currentInSector - maxDrones);
            }

            const delta = target - currentInSector;

            if (delta > 0 && delta > shipDrones) {
                throw abort(
                    commandError(`Cannot deploy ${delta} drones; only ${shipDrones} on ship`),
                );
            }

            if (delta < 0 && shipDrones - delta > maxDrones) {
                throw abort(
                    commandError(`Ship can hold only ${maxDrones - shipDrones} more drones`),
                );
            }

            const updatedShipDrones = shipDrones - delta;
            await setShipDrones(playerId, updatedShipDrones, client);

            const ownerPlayerArg = ownership === 'personal' ? playerId : null;
            const ownerClanArg = ownership === 'clan' ? playerClanId : null;

            if (target === 0 && existing) {
                await deleteSectorDrones(sectorDbId, client);
            } else if (existing && ownershipConverting) {
                await updateSectorDroneOwnerAndQuantity(
                    sectorDbId,
                    ownerPlayerArg,
                    ownerClanArg,
                    target,
                    client,
                );
            } else if (existing) {
                await updateSectorDroneQuantity(sectorDbId, target, client);
            } else if (target > 0) {
                await insertSectorDrones(sectorDbId, ownerPlayerArg, ownerClanArg, target, client);
            }

            return updatedShipDrones;
        },
        async (newShipDrones) => {
            await refreshSectorObservation(playerId, deploySectorDbId);
            return {
                outcome: 'ok' as const,
                sectorDrones: target,
                shipDrones: newShipDrones,
            };
        },
    );
}

export async function serveAttackSectorDrones(
    playerId: number,
    data: CommandRequest<'AttackSectorDrones'>,
): Promise<CommandResult<'AttackSectorDrones'>> {
    const dronesToAttack = data.drones;
    if (!Number.isInteger(dronesToAttack) || dronesToAttack <= 0) {
        return commandError('Invalid number of drones');
    }

    const player = onlinePlayers[playerId];
    if (!player) return;

    if (!(await isInEncounter(playerId))) {
        return commandError('No drone encounter pending');
    }

    const sectorId = player.sector;
    const universeId = player.universeId;

    const sectorDbId = await getSectorDbId(sectorId, universeId);

    return runMutation(
        'Attack sector drones',
        async (client) => {
            const shipDrones = await getShipDronesForUpdate(playerId, client);
            if (shipDrones === undefined) throw abort({ outcome: 'noShip' });

            if (dronesToAttack > shipDrones) {
                throw abort(commandError(`Not enough drones on ship (have ${shipDrones})`));
            }

            if (!sectorDbId) {
                throw abort(commandError('Sector not found'));
            }
            const existing = await getSectorDronesRowForUpdate(sectorDbId, client);
            if (!existing || existing.quantity <= 0) {
                throw abort(commandError('No hostile drones in sector'));
            }

            const sectorDroneQty = existing.quantity;
            const ownerId = existing.owner_player_id;
            const ownerClanId = existing.owner_clan_id;

            const k = Math.min(dronesToAttack, sectorDroneQty);
            const newShipDrones = shipDrones - k;
            const newSectorDrones = sectorDroneQty - k;
            const victory = dronesToAttack >= sectorDroneQty;

            await setShipDrones(playerId, newShipDrones, client);

            if (newSectorDrones <= 0) {
                await deleteSectorDrones(sectorDbId, client);
            } else {
                await updateSectorDroneQuantity(sectorDbId, newSectorDrones, client);
            }

            let repApplied = 0;
            let expApplied = 0;
            if (k > 0) {
                const playerSnap = await getPlayerRepExpForUpdate(playerId, client);
                let ownerAlign = 0;
                if (ownerId !== null) {
                    ownerAlign = await getPlayerReputationForUpdate(ownerId, client);
                } else if (ownerClanId !== null) {
                    ownerAlign = await getClanTotalReputation(ownerClanId, client);
                }
                const matchup = pvfigsMatchup(playerSnap.reputation, ownerAlign);
                const deltas = pvfigsAttackerDeltas({
                    playerDronesLost: k,
                    ownerAlign,
                    matchup,
                });
                repApplied = deltas.reputationDelta;
                expApplied = deltas.experienceDelta;
                if (deltas.experienceDelta !== 0 || deltas.reputationDelta !== 0) {
                    await adjustReputationAndExperience(
                        playerId,
                        deltas.reputationDelta,
                        deltas.experienceDelta,
                        client,
                    );
                }
            }

            return {
                ownerId,
                k,
                newShipDrones,
                newSectorDrones,
                victory,
                repApplied,
                expApplied,
            };
        },
        async (result) => {
            const { ownerId, k, newShipDrones, newSectorDrones, victory } = result;

            const { insertSystemMemo } = await import('../db/queries/message.js');
            const mailRecipients: number[] = [];
            if (ownerId !== null) {
                const owner = onlinePlayers[ownerId];
                if (owner && owner.ws.readyState === 1) {
                    sendEnvelope(ownerId, {
                        type: ServerTag.SectorDronesAlert,
                        event: victory ? 'destroyed' : 'attacked',
                        sector: sectorId,
                        dronesLost: k,
                        dronesRemaining: newSectorDrones,
                        intruderName: player.name,
                    });
                }
                mailRecipients.push(ownerId);
            } else {
                const existing = await getSectorDronesRowForUpdate(sectorDbId!);
                const ownerClanId = existing?.owner_clan_id ?? null;
                if (ownerClanId !== null) {
                    const clanMembers = await getClanMembers(ownerClanId);
                    for (const m of clanMembers) {
                        if (m.id === playerId) continue;
                        mailRecipients.push(m.id);
                        const p = onlinePlayers[m.id];
                        if (p && p.ws.readyState === 1) {
                            sendEnvelope(m.id, {
                                type: ServerTag.SectorDronesAlert,
                                event: victory ? 'destroyed' : 'attacked',
                                sector: sectorId,
                                dronesLost: k,
                                dronesRemaining: newSectorDrones,
                                intruderName: player.name,
                            });
                        }
                    }
                }
            }
            const attackBody = `Report Sector ${sectorId}: ${player.name} is attacking!`;
            const destroyBody = `${player.name} destroyed ${k} of your drones in sector ${sectorId}`;
            for (const rid of mailRecipients) {
                await insertSystemMemo(rid, 'Deployed Drones', 'drones_attacked', attackBody);
                if (k > 0) {
                    await insertSystemMemo(rid, 'Deployed Drones', 'drones_destroyed', destroyBody);
                }
                if (sectorDbId !== undefined && sectorDbId !== null) {
                    await refreshSectorObservation(rid, sectorDbId);
                }
            }
            if (sectorDbId !== undefined && sectorDbId !== null) {
                await refreshSectorObservation(playerId, sectorDbId);
            }
            return {
                outcome: 'ok' as const,
                victory,
                dronesLost: k,
                sectorDronesRemaining: newSectorDrones,
                shipDrones: newShipDrones,
                expDelta: result.expApplied,
                repDelta: result.repApplied,
            };
        },
    );
}

export async function serveRetreatFromDrones(
    playerId: number,
): Promise<CommandResult<'RetreatFromDrones'>> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    if (!(await isInEncounter(playerId))) {
        return commandError('No drone encounter pending');
    }

    const retreatSector = await getPreviousSectorNumber(playerId);
    if (retreatSector === null) {
        return commandError('No previous sector to retreat to');
    }
    const universeId = player.universeId;
    const currentSector = player.sector;

    const retreatSectorId = await resolveSectorId(retreatSector, universeId);
    player.sector = retreatSector;
    player.sectorId = retreatSectorId;
    await Promise.all([
        moveToSector(playerId, retreatSectorId),
        moveShipToSector(playerId, retreatSectorId),
    ]);

    void broadcastPlayerMoved(playerId, currentSector, retreatSector);

    const mineOutcome = await resolveMinesOnEntry(playerId);
    if (mineOutcome.destroyed) return;

    return (await buildSectorDisplayData(playerId, retreatSector)) ?? undefined;
}

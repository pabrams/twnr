import { WebSocket } from 'ws';
import { ServerTag } from '@twnr/shared';
import type { DeployDronesCommand, AttackSectorDronesCommand } from '@twnr/shared';
import { onlinePlayers } from '../state/players.js';
import { sendEnvelope, sendError, broadcastTo } from '../state/messaging.js';
import { getSectorDrones, resolveSectorId } from '../services/sector-lookup.js';
import { buildSectorDisplayData } from '../services/sector-display.js';
import { isInEncounter } from '../services/encounter.js';
import { AbortTransaction } from '../db/index.js';
import { runMutation } from './run-mutation.js';
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

export async function serveListDeployedDrones(playerId: number): Promise<void> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    if (player.docked || player.at_starbase) {
        sendError(playerId, 'Cannot use this command while docked');
        return;
    }

    const rows = await getDeployedDronesByOwner(playerId);
    sendEnvelope(playerId, {
        type: ServerTag.ListDeployedDronesResult,
        drones: rows.map((r) => ({
            sectorId: r.sector_id,
            quantity: r.quantity,
            ownerLabel: formatOwner(r),
            ownership: ownershipFrom(r),
        })),
    });
}

export async function serveDeployDronesInfo(playerId: number): Promise<void> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    if (player.docked) {
        sendError(playerId, 'Cannot deploy while docked');
        return;
    }

    if (await isInEncounter(playerId)) {
        sendError(playerId, 'Resolve drone encounter first');
        return;
    }

    const shipInfo = await getShipDronesAndMaxInfo(playerId);
    if (!shipInfo) {
        sendEnvelope(playerId, { type: ServerTag.NoShip });
        return;
    }
    const sectorDrones = await getSectorDrones(player.sector, player.universeId);

    if (sectorDrones && sectorDrones.ownerId !== playerId) {
        sendError(playerId, 'Sector contains hostile drones');
        return;
    }

    await sendEnvelope(playerId, {
        type: ServerTag.DeployDronesInfoResult,
        sectorDrones: sectorDrones?.quantity ?? 0,
        shipDrones: shipInfo.drones,
        shipMaxDrones: shipInfo.max_drones ?? 0,
    });
}

export async function serveDeployDrones(
    playerId: number,
    data: DeployDronesCommand,
): Promise<void> {
    let target = data.quantity;
    const ownership: 'personal' | 'clan' = data.ownership ?? 'personal';
    if (!Number.isInteger(target) || target < -1) {
        sendError(playerId, 'Invalid target quantity');
        return;
    }

    const player = onlinePlayers[playerId];
    if (!player) return;

    if (player.docked) {
        sendError(playerId, 'Cannot deploy while docked');
        return;
    }

    if (await isInEncounter(playerId)) {
        sendError(playerId, 'Resolve drone encounter first');
        return;
    }

    const sectorId = player.sector;
    const universeId = player.universeId;

    const playerClanId = await getPlayerClanId(playerId);
    if (ownership === 'clan' && playerClanId === null) {
        sendError(playerId, 'You are not in a clan.');
        return;
    }

    const deploySectorDbId = await getSectorDbId(sectorId, universeId);
    if (!deploySectorDbId) {
        sendError(playerId, 'Sector not found');
        return;
    }

    await runMutation(
        playerId,
        'Deploy drones',
        async (client) => {
            const shipInfo = await getShipDronesAndMaxForUpdate(playerId, client);
            if (!shipInfo) {
                sendEnvelope(playerId, { type: ServerTag.NoShip });
                throw new AbortTransaction();
            }

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
                    sendError(playerId, 'Sector contains hostile drones');
                    throw new AbortTransaction();
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
                sendError(playerId, `Cannot deploy ${delta} drones; only ${shipDrones} on ship`);
                throw new AbortTransaction();
            }

            if (delta < 0 && shipDrones - delta > maxDrones) {
                sendError(playerId, `Ship can hold only ${maxDrones - shipDrones} more drones`);
                throw new AbortTransaction();
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
            sendEnvelope(playerId, {
                type: ServerTag.DeployDronesResult,
                sectorDrones: target,
                shipDrones: newShipDrones,
            });
        },
    );
}

export async function serveAttackSectorDrones(
    playerId: number,
    data: AttackSectorDronesCommand,
): Promise<void> {
    const dronesToAttack = data.drones;
    if (!Number.isInteger(dronesToAttack) || dronesToAttack <= 0) {
        sendError(playerId, 'Invalid number of drones');
        return;
    }

    const player = onlinePlayers[playerId];
    if (!player) return;

    if (!(await isInEncounter(playerId))) {
        sendError(playerId, 'No drone encounter pending');
        return;
    }

    const sectorId = player.sector;
    const universeId = player.universeId;

    const sectorDbId = await getSectorDbId(sectorId, universeId);

    await runMutation(
        playerId,
        'Attack sector drones',
        async (client) => {
            const shipDrones = await getShipDronesForUpdate(playerId, client);
            if (shipDrones === undefined) {
                sendEnvelope(playerId, { type: ServerTag.NoShip });
                throw new AbortTransaction();
            }

            if (dronesToAttack > shipDrones) {
                sendError(playerId, `Not enough drones on ship (have ${shipDrones})`);
                throw new AbortTransaction();
            }

            if (!sectorDbId) {
                sendError(playerId, 'Sector not found');
                throw new AbortTransaction();
            }
            const existing = await getSectorDronesRowForUpdate(sectorDbId, client);
            if (!existing || existing.quantity <= 0) {
                sendError(playerId, 'No hostile drones in sector');
                throw new AbortTransaction();
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

            sendEnvelope(playerId, {
                type: ServerTag.AttackSectorDronesResult,
                victory,
                dronesLost: k,
                sectorDronesRemaining: newSectorDrones,
                shipDrones: newShipDrones,
                expDelta: result.expApplied,
                repDelta: result.repApplied,
            });

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
                // Clan-owned drones: alert every member of the clan (online get an
                // inline alert; everyone in the clan gets a mail entry).
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
                // Their mental map should reflect the loss without needing to fly
                // back to the sector themselves.
                if (sectorDbId !== undefined && sectorDbId !== null) {
                    await refreshSectorObservation(rid, sectorDbId);
                }
            }
            // Attacker is in the sector, so refresh their own observation too.
            if (sectorDbId !== undefined && sectorDbId !== null) {
                await refreshSectorObservation(playerId, sectorDbId);
            }
        },
    );
}

export async function serveRetreatFromDrones(playerId: number): Promise<void> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    if (!(await isInEncounter(playerId))) {
        sendError(playerId, 'No drone encounter pending');
        return;
    }

    const retreatSector = await getPreviousSectorNumber(playerId);
    if (retreatSector === null) {
        sendError(playerId, 'No previous sector to retreat to');
        return;
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

    const oldSectorClients = new Set<WebSocket>();
    const newSectorClients = new Set<WebSocket>();
    for (const [idStr, p] of Object.entries(onlinePlayers)) {
        if (Number(idStr) === playerId) continue;
        if (p.universeId !== universeId) continue;
        if (p.docked) continue;
        if (p.sector === currentSector) oldSectorClients.add(p.ws);
        else if (p.sector === retreatSector) newSectorClients.add(p.ws);
    }
    broadcastTo(
        {
            type: ServerTag.PlayerMoved,
            playerId,
            playerName: player.name,
            sector: retreatSector,
            direction: 'out',
        },
        oldSectorClients,
    );
    broadcastTo(
        {
            type: ServerTag.PlayerMoved,
            playerId,
            playerName: player.name,
            sector: retreatSector,
            direction: 'in',
        },
        newSectorClients,
    );

    const mineOutcome = await resolveMinesOnEntry(playerId);
    if (mineOutcome.destroyed) return;

    await sendEnvelope(playerId, {
        type: ServerTag.RetreatFromDronesResult,
        sector: retreatSector,
    });

    const sectorData = await buildSectorDisplayData(playerId, retreatSector);
    if (sectorData) {
        sendEnvelope(playerId, { type: ServerTag.SectorDisplayResult, ...sectorData });
    }
}

import { WebSocket } from 'ws';
import { ServerMsgType } from '@twnr/shared';
import { players } from '../state/players.js';
import { sendEnvelope, sendError, broadcastTo } from '../state/messaging.js';
import { getSectorDrones, resolveSectorId } from '../services/sector-lookup.js';
import { buildSectorDisplayData } from '../services/sector-display.js';
import { isInEncounter } from '../services/encounter.js';
import { withTransaction, AbortTransaction } from '../db/index.js';
import { moveToSector, getPreviousSectorNumber } from '../db/queries/player.js';
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
    insertSectorDrones,
    deleteSectorDrones,
} from '../db/queries/drones.js';
import { resolveMinesOnEntry } from '../services/mine-encounter.js';

export async function handleDeployDronesInfo(playerId: number): Promise<void> {
    const player = players[playerId];
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
        sendEnvelope(playerId, { type: ServerMsgType.NoShip });
        return;
    }
    const sectorDrones = await getSectorDrones(player.sector, player.universeId);

    if (sectorDrones && sectorDrones.ownerId !== playerId) {
        sendError(playerId, 'Sector contains hostile drones');
        return;
    }

    // No menu transition — the deployDronesQty menu is gone. The client's
    // deployDronesInfo handler displays the info and asks for qty inline
    // via askNumber, then sends DeployDrones. Player stays on sector.
    await sendEnvelope(playerId, {
        type: ServerMsgType.DeployDronesInfoResult,
        sectorDrones: sectorDrones?.quantity ?? 0,
        shipDrones: shipInfo.drones,
        shipMaxDrones: shipInfo.max_drones ?? 0,
    });
}

export async function handleDeployDrones(
    playerId: number,
    target: number,
    ownership: 'personal' | 'clan' = 'personal',
): Promise<void> {
    if (!Number.isInteger(target) || target < -1) {
        sendError(playerId, 'Invalid target quantity');
        return;
    }

    const player = players[playerId];
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

    // Resolve viewer's clan_id for clan-ownership deploys.
    let playerClanId: number | null = null;
    if (ownership === 'clan') {
        const { pool } = await import('../db/index.js');
        const r = await pool.query<{ clan_id: number | null }>(
            'SELECT clan_id FROM players WHERE id = $1',
            [playerId],
        );
        playerClanId = r.rows[0]?.clan_id ?? null;
        if (playerClanId === null) {
            sendError(playerId, 'You are not in a clan.');
            return;
        }
    }

    try {
        const newShipDrones = await withTransaction(async (client) => {
            const shipInfo = await getShipDronesAndMaxForUpdate(playerId, client);
            if (!shipInfo) {
                sendEnvelope(playerId, { type: ServerMsgType.NoShip });
                throw new AbortTransaction();
            }

            const shipDrones = shipInfo.drones;
            const maxDrones = shipInfo.max_drones ?? 0;

            const sectorDbId = await getSectorDbId(sectorId, universeId);
            if (!sectorDbId) {
                sendError(playerId, 'Sector not found');
                throw new AbortTransaction();
            }

            const existing = await getSectorDronesRowForUpdate(sectorDbId, client);

            let currentInSector = 0;
            if (existing) {
                const matchesDeploy =
                    (ownership === 'personal' && existing.owner_player_id === playerId) ||
                    (ownership === 'clan' && existing.owner_clan_id === playerClanId);
                if (!matchesDeploy) {
                    const friendly =
                        existing.owner_player_id === playerId ||
                        (playerClanId !== null && existing.owner_clan_id === playerClanId);
                    sendError(
                        playerId,
                        friendly
                            ? 'Sector already has drones with a different ownership.'
                            : 'Sector contains hostile drones',
                    );
                    throw new AbortTransaction();
                }
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
            } else if (existing) {
                await updateSectorDroneQuantity(sectorDbId, target, client);
            } else if (target > 0) {
                await insertSectorDrones(sectorDbId, ownerPlayerArg, ownerClanArg, target, client);
            }

            return updatedShipDrones;
        });

        if (newShipDrones === undefined) return;

        await sendEnvelope(playerId, {
            type: ServerMsgType.DeployDronesResult,
            sectorDrones: target,
            shipDrones: newShipDrones,
        });
    } catch (err) {
        console.error('Deploy drones error', err);
        sendError(playerId, 'Internal server error');
    }
}

export async function handleAttackSectorDrones(
    playerId: number,
    dronesToAttack: number,
): Promise<void> {
    if (!Number.isInteger(dronesToAttack) || dronesToAttack <= 0) {
        sendError(playerId, 'Invalid number of drones');
        return;
    }

    const player = players[playerId];
    if (!player) return;

    if (!(await isInEncounter(playerId))) {
        sendError(playerId, 'No drone encounter pending');
        return;
    }

    const sectorId = player.sector;
    const universeId = player.universeId;

    const sectorDbId = await getSectorDbId(sectorId, universeId);

    try {
        const result = await withTransaction(async (client) => {
            const shipDrones = await getShipDronesForUpdate(playerId, client);
            if (shipDrones === undefined) {
                sendEnvelope(playerId, { type: ServerMsgType.NoShip });
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

            return { ownerId, k, newShipDrones, newSectorDrones, victory };
        });

        if (!result) return;

        const { ownerId, k, newShipDrones, newSectorDrones, victory } = result;

        await sendEnvelope(playerId, {
            type: ServerMsgType.AttackSectorDronesResult,
            victory,
            dronesLost: k,
            sectorDronesRemaining: newSectorDrones,
            shipDrones: newShipDrones,
        });

        if (ownerId !== null) {
            const owner = players[ownerId];
            if (owner && owner.ws.readyState === 1) {
                sendEnvelope(ownerId, {
                    type: ServerMsgType.SectorDronesAlert,
                    event: victory ? 'destroyed' : 'attacked',
                    sector: sectorId,
                    dronesLost: k,
                    dronesRemaining: newSectorDrones,
                    intruderName: player.name,
                });
            }
        }
        // TODO: when sector drones are clan-owned, alert all online clan
        // members instead. Deferred until phase 6 transfer/memo wiring.
    } catch (err) {
        console.error('Attack sector drones error', err);
        sendError(playerId, 'Internal server error');
    }
}

export async function handleRetreatFromDrones(playerId: number): Promise<void> {
    const player = players[playerId];
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
    for (const [idStr, p] of Object.entries(players)) {
        if (Number(idStr) === playerId) continue;
        if (p.universeId !== universeId) continue;
        if (p.docked) continue;
        if (p.sector === currentSector) oldSectorClients.add(p.ws);
        else if (p.sector === retreatSector) newSectorClients.add(p.ws);
    }
    broadcastTo(
        {
            type: ServerMsgType.PlayerMoved,
            playerId,
            playerName: player.name,
            sector: retreatSector,
            direction: 'out',
        },
        oldSectorClients,
    );
    broadcastTo(
        {
            type: ServerMsgType.PlayerMoved,
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
        type: ServerMsgType.RetreatFromDronesResult,
        sector: retreatSector,
    });

    const sectorData = await buildSectorDisplayData(playerId, retreatSector);
    if (sectorData) {
        sendEnvelope(playerId, { type: ServerMsgType.SectorDisplayResult, ...sectorData });
    }
}

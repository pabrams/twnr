import { WebSocket } from 'ws';
import { ServerMsgType } from '@twnr/shared';
import {
    players,
    sendEnvelope,
    getSectorDrones,
    broadcastTo,
    buildSectorDisplayData,
    setPlayerMenu,
    resolveSectorId,
} from '../game-state.js';
import { withTransaction, AbortTransaction } from '../db/index.js';
import { moveToSector } from '../db/queries/player.js';
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

export async function handleDeployDronesInfo(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (player.docked) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'Cannot deploy while docked',
        });
        return;
    }

    if (player.pendingEncounter) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'Resolve drone encounter first',
        });
        return;
    }

    const shipInfo = await getShipDronesAndMaxInfo(playerId);
    if (!shipInfo) {
        sendEnvelope(playerId, { type: ServerMsgType.NoShip });
        return;
    }
    const sectorDrones = await getSectorDrones(player.sector, player.universeId);

    if (sectorDrones && sectorDrones.ownerId !== playerId) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'Sector contains hostile drones',
        });
        return;
    }

    await setPlayerMenu(playerId, 'deployDronesQty');
    sendEnvelope(playerId, {
        type: ServerMsgType.DeployDronesInfoResult,
        sectorDrones: sectorDrones?.quantity ?? 0,
        shipDrones: shipInfo.drones,
        shipMaxDrones: shipInfo.max_drones ?? 0,
    });
}

export async function handleDeployDrones(playerId: number, target: number): Promise<void> {
    if (!Number.isInteger(target) || target < 0) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Invalid target quantity' });
        return;
    }

    const player = players[playerId];
    if (!player) return;

    if (player.docked) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'Cannot deploy while docked',
        });
        return;
    }

    if (player.pendingEncounter) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'Resolve drone encounter first',
        });
        return;
    }

    const sectorId = player.sector;
    const universeId = player.universeId;

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
                sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Sector not found' });
                throw new AbortTransaction();
            }

            const existing = await getSectorDronesRowForUpdate(sectorDbId, client);

            let currentInSector = 0;
            if (existing) {
                if (existing.owner_id !== playerId) {
                    sendEnvelope(playerId, {
                        type: ServerMsgType.Error,
                        message: 'Sector contains hostile drones',
                    });
                    throw new AbortTransaction();
                }
                currentInSector = existing.quantity;
            }

            const delta = target - currentInSector;

            if (delta > 0 && delta > shipDrones) {
                sendEnvelope(playerId, {
                    type: ServerMsgType.Error,
                    message: `Cannot deploy ${delta} drones; only ${shipDrones} on ship`,
                });
                throw new AbortTransaction();
            }

            if (delta < 0 && shipDrones - delta > maxDrones) {
                sendEnvelope(playerId, {
                    type: ServerMsgType.Error,
                    message: `Ship can hold only ${maxDrones - shipDrones} more drones`,
                });
                throw new AbortTransaction();
            }

            const updatedShipDrones = shipDrones - delta;
            await setShipDrones(playerId, updatedShipDrones, client);

            if (target === 0 && existing) {
                await deleteSectorDrones(sectorDbId, playerId, client);
            } else if (existing) {
                await updateSectorDroneQuantity(sectorDbId, playerId, target, client);
            } else if (target > 0) {
                await insertSectorDrones(sectorDbId, playerId, target, client);
            }

            return updatedShipDrones;
        });

        if (newShipDrones === undefined) return;

        await setPlayerMenu(playerId, 'sector');
        sendEnvelope(playerId, {
            type: ServerMsgType.DeployDronesResult,
            sectorDrones: target,
            shipDrones: newShipDrones,
        });
    } catch (err) {
        console.error('Deploy drones error', err);
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Internal server error' });
    }
}

export async function handleAttackSectorDrones(
    playerId: number,
    dronesToAttack: number,
): Promise<void> {
    if (!Number.isInteger(dronesToAttack) || dronesToAttack <= 0) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'Invalid number of drones',
        });
        return;
    }

    const player = players[playerId];
    if (!player) return;

    if (!player.pendingEncounter) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'No drone encounter pending',
        });
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
                sendEnvelope(playerId, {
                    type: ServerMsgType.Error,
                    message: `Not enough drones on ship (have ${shipDrones})`,
                });
                throw new AbortTransaction();
            }

            if (!sectorDbId) {
                sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Sector not found' });
                throw new AbortTransaction();
            }
            const existing = await getSectorDronesRowForUpdate(sectorDbId, client);
            if (!existing || existing.quantity <= 0) {
                player.pendingEncounter = undefined;
                sendEnvelope(playerId, {
                    type: ServerMsgType.Error,
                    message: 'No hostile drones in sector',
                });
                throw new AbortTransaction();
            }

            const sectorDroneQty = existing.quantity;
            const ownerId = existing.owner_id;

            const k = Math.min(dronesToAttack, sectorDroneQty);
            const newShipDrones = shipDrones - k;
            const newSectorDrones = sectorDroneQty - k;
            const victory = dronesToAttack >= sectorDroneQty;

            await setShipDrones(playerId, newShipDrones, client);

            if (newSectorDrones <= 0) {
                await deleteSectorDrones(sectorDbId, ownerId, client);
            } else {
                await updateSectorDroneQuantity(sectorDbId, ownerId, newSectorDrones, client);
            }

            return { ownerId, k, newShipDrones, newSectorDrones, victory };
        });

        if (!result) return;

        const { ownerId, k, newShipDrones, newSectorDrones, victory } = result;

        if (victory) {
            player.pendingEncounter = undefined;
            await setPlayerMenu(playerId, 'sector');
        }

        sendEnvelope(playerId, {
            type: ServerMsgType.AttackSectorDronesResult,
            victory,
            dronesLost: k,
            sectorDronesRemaining: newSectorDrones,
            shipDrones: newShipDrones,
        });

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
    } catch (err) {
        console.error('Attack sector drones error', err);
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Internal server error' });
    }
}

export async function handleRetreatFromDrones(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (!player.pendingEncounter) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'No drone encounter pending',
        });
        return;
    }

    const retreatSector = player.pendingEncounter.retreatSector;
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
        { type: ServerMsgType.PlayerMoved, playerId, sector: retreatSector, direction: 'out' },
        oldSectorClients,
    );
    broadcastTo(
        { type: ServerMsgType.PlayerMoved, playerId, sector: retreatSector, direction: 'in' },
        newSectorClients,
    );

    player.pendingEncounter = undefined;
    await setPlayerMenu(playerId, 'sector');

    sendEnvelope(playerId, {
        type: ServerMsgType.RetreatFromDronesResult,
        sector: retreatSector,
    });

    const sectorData = await buildSectorDisplayData(playerId, retreatSector);
    if (sectorData) {
        sendEnvelope(playerId, { type: ServerMsgType.SectorDisplayResult, ...sectorData });
    }
}

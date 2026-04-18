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
import { pool } from '../db/index.js';
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

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const shipInfo = await getShipDronesAndMaxForUpdate(playerId, client);
        if (!shipInfo) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.NoShip });
            return;
        }

        const shipDrones = shipInfo.drones;
        const maxDrones = shipInfo.max_drones ?? 0;

        const sectorDbId = await getSectorDbId(sectorId, universeId);
        if (!sectorDbId) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Sector not found' });
            return;
        }

        const existing = await getSectorDronesRowForUpdate(sectorDbId, client);

        let currentInSector = 0;
        if (existing) {
            if (existing.owner_id !== playerId) {
                await client.query('ROLLBACK');
                sendEnvelope(playerId, {
                    type: ServerMsgType.Error,
                    message: 'Sector contains hostile drones',
                });
                return;
            }
            currentInSector = existing.quantity;
        }

        const delta = target - currentInSector;

        if (delta > 0 && delta > shipDrones) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, {
                type: ServerMsgType.Error,
                message: `Cannot deploy ${delta} drones; only ${shipDrones} on ship`,
            });
            return;
        }

        if (delta < 0) {
            const returning = -delta;
            if (shipDrones + returning > maxDrones) {
                await client.query('ROLLBACK');
                sendEnvelope(playerId, {
                    type: ServerMsgType.Error,
                    message: `Ship can hold only ${maxDrones - shipDrones} more drones`,
                });
                return;
            }
        }

        const newShipDrones = shipDrones - delta;

        await setShipDrones(playerId, newShipDrones, client);

        if (target === 0 && existing) {
            await deleteSectorDrones(sectorDbId, playerId, client);
        } else if (existing) {
            await updateSectorDroneQuantity(sectorDbId, playerId, target, client);
        } else if (target > 0) {
            await insertSectorDrones(sectorDbId, playerId, target, client);
        }

        await client.query('COMMIT');

        await setPlayerMenu(playerId, 'sector');
        sendEnvelope(playerId, {
            type: ServerMsgType.DeployDronesResult,
            sectorDrones: target,
            shipDrones: newShipDrones,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Deploy drones error', err);
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
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

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const shipDrones = await getShipDronesForUpdate(playerId, client);
        if (shipDrones === undefined) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.NoShip });
            return;
        }

        if (dronesToAttack > shipDrones) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, {
                type: ServerMsgType.Error,
                message: `Not enough drones on ship (have ${shipDrones})`,
            });
            return;
        }

        if (!sectorDbId) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Sector not found' });
            return;
        }
        const existing = await getSectorDronesRowForUpdate(sectorDbId, client);
        if (!existing || existing.quantity <= 0) {
            await client.query('ROLLBACK');
            player.pendingEncounter = undefined;
            sendEnvelope(playerId, {
                type: ServerMsgType.Error,
                message: 'No hostile drones in sector',
            });
            return;
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

        await client.query('COMMIT');

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
        await client.query('ROLLBACK');
        console.error('Attack sector drones error', err);
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
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

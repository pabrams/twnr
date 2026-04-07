import { WebSocket } from 'ws';
import { ServerMsgType } from '@twnr/shared';
import {
    players,
    sendEnvelope,
    getSectorDrones,
    getPortForSector,
    getVisitedSectors,
    getGraph,
    broadcastTo,
    setPlayerMenu,
    resolveSectorId,
} from '../game-state.js';
import { pool } from '../db/index.js';
import { shipConfigs } from '../ship-config.js';

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

    const shipRes = await pool.query(
        'SELECT ps.drones, ps.ship_name FROM player_ships ps WHERE ps.player_id = $1',
        [playerId],
    );
    if (shipRes.rows.length === 0) {
        sendEnvelope(playerId, { type: ServerMsgType.NoShip });
        return;
    }

    const shipCfg = shipConfigs[shipRes.rows[0].ship_name];
    const sectorDrones = await getSectorDrones(player.sector, player.universeId);

    // Only show own drones or no drones; can't deploy into hostile sector
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
        shipDrones: shipRes.rows[0].drones,
        shipMaxDrones: shipCfg?.maxDrones ?? 0,
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

        const shipRes = await client.query(
            'SELECT drones, ship_name FROM player_ships WHERE player_id = $1 FOR UPDATE',
            [playerId],
        );
        if (shipRes.rows.length === 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.NoShip });
            return;
        }

        const shipDrones = shipRes.rows[0].drones;
        const shipCfg = shipConfigs[shipRes.rows[0].ship_name];
        const maxDrones = shipCfg?.maxDrones ?? 0;

        // Look up sector DB id
        const sectorLookup = await client.query(
            'SELECT id FROM sectors WHERE sector_number = $1 AND universe_id = $2',
            [sectorId, universeId],
        );
        if (sectorLookup.rows.length === 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Sector not found' });
            return;
        }
        const sectorDbId = sectorLookup.rows[0].id;

        // Lock existing sector drones row if present
        const sfRes = await client.query(
            'SELECT quantity, owner_id FROM sector_drones WHERE sector_id = $1 FOR UPDATE',
            [sectorDbId],
        );

        let currentInSector = 0;
        if (sfRes.rows.length > 0) {
            if (sfRes.rows[0].owner_id !== playerId) {
                await client.query('ROLLBACK');
                sendEnvelope(playerId, {
                    type: ServerMsgType.Error,
                    message: 'Sector contains hostile drones',
                });
                return;
            }
            currentInSector = sfRes.rows[0].quantity;
        }

        const delta = target - currentInSector;

        // Deploying more drones
        if (delta > 0 && delta > shipDrones) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, {
                type: ServerMsgType.Error,
                message: `Cannot deploy ${delta} drones; only ${shipDrones} on ship`,
            });
            return;
        }

        // Retrieving drones — check ship capacity
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

        // Update ship
        await client.query('UPDATE player_ships SET drones = $1 WHERE player_id = $2', [
            newShipDrones,
            playerId,
        ]);

        // Update sector drones
        if (target === 0 && sfRes.rows.length > 0) {
            await client.query('DELETE FROM sector_drones WHERE sector_id = $1 AND owner_id = $2', [
                sectorDbId,
                playerId,
            ]);
        } else if (sfRes.rows.length > 0) {
            await client.query(
                'UPDATE sector_drones SET quantity = $1 WHERE sector_id = $2 AND owner_id = $3',
                [target, sectorDbId, playerId],
            );
        } else if (target > 0) {
            await client.query(
                'INSERT INTO sector_drones (sector_id, owner_id, quantity) VALUES ($1, $2, $3)',
                [sectorDbId, playerId, target],
            );
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

    // Look up sector DB id
    const sectorLookup = await pool.query(
        'SELECT id FROM sectors WHERE sector_number = $1 AND universe_id = $2',
        [sectorId, universeId],
    );
    const sectorDbId = sectorLookup.rows[0]?.id;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const shipRes = await client.query(
            'SELECT drones FROM player_ships WHERE player_id = $1 FOR UPDATE',
            [playerId],
        );
        if (shipRes.rows.length === 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.NoShip });
            return;
        }

        const shipDrones = shipRes.rows[0].drones;
        if (dronesToAttack > shipDrones) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, {
                type: ServerMsgType.Error,
                message: `Not enough drones on ship (have ${shipDrones})`,
            });
            return;
        }

        const sfRes = await client.query(
            'SELECT quantity, owner_id FROM sector_drones WHERE sector_id = $1 FOR UPDATE',
            [sectorDbId],
        );
        if (sfRes.rows.length === 0 || sfRes.rows[0].quantity <= 0) {
            await client.query('ROLLBACK');
            player.pendingEncounter = undefined;
            sendEnvelope(playerId, {
                type: ServerMsgType.Error,
                message: 'No hostile drones in sector',
            });
            return;
        }

        const sectorDroneQty = sfRes.rows[0].quantity;
        const ownerId = sfRes.rows[0].owner_id;

        // 1:1 attrition
        const k = Math.min(dronesToAttack, sectorDroneQty);
        const newShipDrones = shipDrones - k;
        const newSectorDrones = sectorDroneQty - k;
        const victory = dronesToAttack >= sectorDroneQty;

        // Update ship drones
        await client.query('UPDATE player_ships SET drones = $1 WHERE player_id = $2', [
            newShipDrones,
            playerId,
        ]);

        // Update or delete sector drones
        if (newSectorDrones <= 0) {
            await client.query('DELETE FROM sector_drones WHERE sector_id = $1 AND owner_id = $2', [
                sectorDbId,
                ownerId,
            ]);
        } else {
            await client.query(
                'UPDATE sector_drones SET quantity = $1 WHERE sector_id = $2 AND owner_id = $3',
                [newSectorDrones, sectorDbId, ownerId],
            );
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

        // Alert the owner
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

    // Move player back
    const retreatSectorId = await resolveSectorId(retreatSector, universeId);
    player.sector = retreatSector;
    player.sectorId = retreatSectorId;
    await pool.query('UPDATE players SET current_sector_id = $1 WHERE id = $2', [
        retreatSectorId,
        playerId,
    ]);

    // Broadcast movement
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

    // Send sector display for the retreat sector
    const [warps, port, visitedSectors, sectorDrones, planetsRes] = await Promise.all([
        getGraph(universeId),
        getPortForSector(retreatSector, universeId),
        getVisitedSectors(playerId),
        getSectorDrones(retreatSector, universeId),
        pool.query(
            `SELECT pl.id, pl.name, pl.type FROM planets pl
             JOIN sectors s ON pl.sector_id = s.id
             WHERE s.sector_number = $1 AND s.universe_id = $2 ORDER BY pl.id`,
            [retreatSector, universeId],
        ),
    ]);
    const planets = planetsRes.rows;
    const displayWarps = warps[retreatSector] || [];
    const playersInSector = Object.entries(players)
        .filter(
            ([id, p]) =>
                p.sector === retreatSector &&
                p.universeId === universeId &&
                !p.docked &&
                Number(id) !== playerId,
        )
        .map(([id, p]) => ({ id: Number(id), name: p.name }));
    sendEnvelope(playerId, {
        type: ServerMsgType.SectorDisplayResult,
        sector: retreatSector,
        warps: displayWarps,
        players: playersInSector,
        port,
        visitedSectors,
        sectorDrones,
        planets,
    });
}

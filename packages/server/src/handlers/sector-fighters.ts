import { WebSocket } from 'ws';
import { ServerMsgType } from '@twnr/shared';
import {
    players,
    send,
    getSectorFighters,
    getPortForSector,
    getVisitedSectors,
    getGraph,
    broadcastTo,
} from '../game-state.js';
import { pool } from '../db/index.js';
import { shipConfigs } from '../ship-config.js';

export async function handleDeployFightersInfo(ws: WebSocket, playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (player.docked) {
        send(ws, { type: ServerMsgType.Error, message: 'Cannot deploy while docked' });
        return;
    }

    if (player.pendingEncounter) {
        send(ws, { type: ServerMsgType.Error, message: 'Resolve fighter encounter first' });
        return;
    }

    const shipRes = await pool.query(
        'SELECT ps.fighters, ps.ship_name FROM player_ships ps WHERE ps.player_id = $1',
        [playerId],
    );
    if (shipRes.rows.length === 0) {
        send(ws, { type: ServerMsgType.NoShip });
        return;
    }

    const shipCfg = shipConfigs[shipRes.rows[0].ship_name];
    const sectorFighters = await getSectorFighters(player.sector, player.universeId);

    // Only show own fighters or no fighters; can't deploy into hostile sector
    if (sectorFighters && sectorFighters.ownerId !== playerId) {
        send(ws, { type: ServerMsgType.Error, message: 'Sector contains hostile fighters' });
        return;
    }

    send(ws, {
        type: ServerMsgType.DeployFightersInfo,
        sectorFighters: sectorFighters?.quantity ?? 0,
        shipFighters: shipRes.rows[0].fighters,
        shipMaxFighters: shipCfg?.maxFighters ?? 0,
    });
}

export async function handleDeployFighters(
    ws: WebSocket,
    playerId: number,
    target: number,
): Promise<void> {
    if (!Number.isInteger(target) || target < 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Invalid target quantity' });
        return;
    }

    const player = players[playerId];
    if (!player) return;

    if (player.docked) {
        send(ws, { type: ServerMsgType.Error, message: 'Cannot deploy while docked' });
        return;
    }

    if (player.pendingEncounter) {
        send(ws, { type: ServerMsgType.Error, message: 'Resolve fighter encounter first' });
        return;
    }

    const sectorId = player.sector;
    const universeId = player.universeId;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const shipRes = await client.query(
            'SELECT fighters, ship_name FROM player_ships WHERE player_id = $1 FOR UPDATE',
            [playerId],
        );
        if (shipRes.rows.length === 0) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.NoShip });
            return;
        }

        const shipFighters = shipRes.rows[0].fighters;
        const shipCfg = shipConfigs[shipRes.rows[0].ship_name];
        const maxFighters = shipCfg?.maxFighters ?? 0;

        // Lock existing sector fighters row if present
        const sfRes = await client.query(
            'SELECT quantity, owner_id FROM sector_fighters WHERE sector_id = $1 AND universe_id = $2 FOR UPDATE',
            [sectorId, universeId],
        );

        let currentInSector = 0;
        if (sfRes.rows.length > 0) {
            if (sfRes.rows[0].owner_id !== playerId) {
                await client.query('ROLLBACK');
                send(ws, {
                    type: ServerMsgType.Error,
                    message: 'Sector contains hostile fighters',
                });
                return;
            }
            currentInSector = sfRes.rows[0].quantity;
        }

        const delta = target - currentInSector;

        // Deploying more fighters
        if (delta > 0 && delta > shipFighters) {
            await client.query('ROLLBACK');
            send(ws, {
                type: ServerMsgType.Error,
                message: `Cannot deploy ${delta} fighters; only ${shipFighters} on ship`,
            });
            return;
        }

        // Retrieving fighters — check ship capacity
        if (delta < 0) {
            const returning = -delta;
            if (shipFighters + returning > maxFighters) {
                await client.query('ROLLBACK');
                send(ws, {
                    type: ServerMsgType.Error,
                    message: `Ship can hold only ${maxFighters - shipFighters} more fighters`,
                });
                return;
            }
        }

        const newShipFighters = shipFighters - delta;

        // Update ship
        await client.query('UPDATE player_ships SET fighters = $1 WHERE player_id = $2', [
            newShipFighters,
            playerId,
        ]);

        // Update sector fighters
        if (target === 0 && sfRes.rows.length > 0) {
            await client.query(
                'DELETE FROM sector_fighters WHERE sector_id = $1 AND universe_id = $2 AND owner_id = $3',
                [sectorId, universeId, playerId],
            );
        } else if (sfRes.rows.length > 0) {
            await client.query(
                'UPDATE sector_fighters SET quantity = $1 WHERE sector_id = $2 AND universe_id = $3 AND owner_id = $4',
                [target, sectorId, universeId, playerId],
            );
        } else if (target > 0) {
            await client.query(
                'INSERT INTO sector_fighters (sector_id, universe_id, owner_id, quantity) VALUES ($1, $2, $3, $4)',
                [sectorId, universeId, playerId, target],
            );
        }

        await client.query('COMMIT');

        send(ws, {
            type: ServerMsgType.DeployFightersResult,
            sectorFighters: target,
            shipFighters: newShipFighters,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Deploy fighters error', err);
        send(ws, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
    }
}

export async function handleAttackSectorFighters(
    ws: WebSocket,
    playerId: number,
    fightersToAttack: number,
): Promise<void> {
    if (!Number.isInteger(fightersToAttack) || fightersToAttack <= 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Invalid number of fighters' });
        return;
    }

    const player = players[playerId];
    if (!player) return;

    if (!player.pendingEncounter) {
        send(ws, { type: ServerMsgType.Error, message: 'No fighter encounter pending' });
        return;
    }

    const sectorId = player.sector;
    const universeId = player.universeId;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const shipRes = await client.query(
            'SELECT fighters FROM player_ships WHERE player_id = $1 FOR UPDATE',
            [playerId],
        );
        if (shipRes.rows.length === 0) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.NoShip });
            return;
        }

        const shipFighters = shipRes.rows[0].fighters;
        if (fightersToAttack > shipFighters) {
            await client.query('ROLLBACK');
            send(ws, {
                type: ServerMsgType.Error,
                message: `Not enough fighters on ship (have ${shipFighters})`,
            });
            return;
        }

        const sfRes = await client.query(
            'SELECT quantity, owner_id FROM sector_fighters WHERE sector_id = $1 AND universe_id = $2 FOR UPDATE',
            [sectorId, universeId],
        );
        if (sfRes.rows.length === 0 || sfRes.rows[0].quantity <= 0) {
            await client.query('ROLLBACK');
            player.pendingEncounter = undefined;
            send(ws, { type: ServerMsgType.Error, message: 'No hostile fighters in sector' });
            return;
        }

        const sectorFighterQty = sfRes.rows[0].quantity;
        const ownerId = sfRes.rows[0].owner_id;

        // 1:1 attrition
        const k = Math.min(fightersToAttack, sectorFighterQty);
        const newShipFighters = shipFighters - k;
        const newSectorFighters = sectorFighterQty - k;
        const victory = fightersToAttack >= sectorFighterQty;

        // Update ship fighters
        await client.query('UPDATE player_ships SET fighters = $1 WHERE player_id = $2', [
            newShipFighters,
            playerId,
        ]);

        // Update or delete sector fighters
        if (newSectorFighters <= 0) {
            await client.query(
                'DELETE FROM sector_fighters WHERE sector_id = $1 AND universe_id = $2 AND owner_id = $3',
                [sectorId, universeId, ownerId],
            );
        } else {
            await client.query(
                'UPDATE sector_fighters SET quantity = $1 WHERE sector_id = $2 AND universe_id = $3 AND owner_id = $4',
                [newSectorFighters, sectorId, universeId, ownerId],
            );
        }

        await client.query('COMMIT');

        if (victory) {
            player.pendingEncounter = undefined;
        }

        send(ws, {
            type: ServerMsgType.SectorFighterCombatResult,
            victory,
            fightersLost: k,
            sectorFightersRemaining: newSectorFighters,
            shipFighters: newShipFighters,
        });

        // Alert the owner
        const owner = players[ownerId];
        if (owner && owner.ws.readyState === 1) {
            send(owner.ws, {
                type: ServerMsgType.SectorFightersAlert,
                event: victory ? 'destroyed' : 'attacked',
                sector: sectorId,
                fightersLost: k,
                fightersRemaining: newSectorFighters,
                intruderName: player.name,
            });
        }
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Attack sector fighters error', err);
        send(ws, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
    }
}

export async function handleRetreatFromFighters(ws: WebSocket, playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (!player.pendingEncounter) {
        send(ws, { type: ServerMsgType.Error, message: 'No fighter encounter pending' });
        return;
    }

    const retreatSector = player.pendingEncounter.retreatSector;
    const universeId = player.universeId;
    const currentSector = player.sector;

    // Move player back
    player.sector = retreatSector;
    await pool.query('UPDATE players SET current_sector = $1 WHERE id = $2', [
        retreatSector,
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

    send(ws, { type: ServerMsgType.RetreatResult, sector: retreatSector });

    // Send sector display for the retreat sector
    const [warps, port, visitedSectors, sectorFighters, planetsRes] = await Promise.all([
        getGraph(universeId),
        getPortForSector(retreatSector, universeId),
        getVisitedSectors(playerId),
        getSectorFighters(retreatSector, universeId),
        pool.query(
            'SELECT id, name, type FROM planets WHERE sector_id = $1 AND universe_id = $2 ORDER BY id',
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
    send(ws, {
        type: ServerMsgType.SectorDisplay,
        sector: retreatSector,
        warps: displayWarps,
        players: playersInSector,
        port,
        visitedSectors,
        sectorFighters,
        planets,
    });
}

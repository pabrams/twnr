import { WebSocket } from 'ws';
import { ServerMsgType } from '@twnr/shared';
import { players, send, getPlayerUniverseId, getGraph } from '../game-state.js';
import { pool } from '../db/index.js';
import { shipConfigs } from '../ship-config.js';
import { checkAndDeductTurns } from '../turn-logic.js';

export async function handleBuyHyperwarpDrive(
    ws: WebSocket,
    playerId: number,
): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (!player.at_stardock) {
        send(ws, { type: ServerMsgType.Error, message: 'Not at Stardock' });
        return;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const shipRes = await client.query(
            'SELECT ship_name, has_hyperwarp_drive FROM player_ships WHERE player_id = $1 FOR UPDATE',
            [playerId],
        );
        if (shipRes.rows.length === 0) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Ship not found' });
            return;
        }

        const config = shipConfigs[shipRes.rows[0].ship_name];
        if (!config || config.canHaveHyperwarp === false) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Ship incapable of hyperwarp drive' });
            return;
        }

        if (shipRes.rows[0].has_hyperwarp_drive) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Ship already has hyperwarp drive' });
            return;
        }

        const cargoRes = await client.query(
            'SELECT credits FROM ship_cargo WHERE player_id = $1 FOR UPDATE',
            [playerId],
        );
        if (cargoRes.rows.length === 0 || cargoRes.rows[0].credits < 50000) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Insufficient credits' });
            return;
        }

        await client.query(
            'UPDATE player_ships SET has_hyperwarp_drive = TRUE WHERE player_id = $1',
            [playerId],
        );
        await client.query(
            'UPDATE ship_cargo SET credits = credits - 50000 WHERE player_id = $1',
            [playerId],
        );
        await client.query('COMMIT');

        send(ws, {
            type: ServerMsgType.BuyHyperwarpDriveResult,
            credits: cargoRes.rows[0].credits - 50000,
        });
    } catch {
        await client.query('ROLLBACK');
        send(ws, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
    }
}

export async function handleListDeployedFighters(
    ws: WebSocket,
    playerId: number,
): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (player.docked || player.at_stardock) {
        send(ws, { type: ServerMsgType.Error, message: 'Cannot use this command while docked' });
        return;
    }

    const playerRes = await pool.query('SELECT on_planet_id FROM players WHERE id = $1', [
        playerId,
    ]);
    if (playerRes.rows[0]?.on_planet_id) {
        send(ws, { type: ServerMsgType.Error, message: 'Cannot use this command while on a planet' });
        return;
    }

    const res = await pool.query(
        'SELECT sector_id, quantity FROM sector_fighters WHERE owner_id = $1 AND quantity > 0',
        [playerId],
    );

    send(ws, {
        type: ServerMsgType.ListDeployedFightersResult,
        fighters: res.rows.map((r: any) => ({ sectorId: r.sector_id, quantity: r.quantity })),
    });
}

export async function handleHyperspaceJump(
    ws: WebSocket,
    playerId: number,
    targetSector: number,
): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (player.docked || player.at_stardock) {
        send(ws, { type: ServerMsgType.Error, message: 'Cannot use this command while docked' });
        return;
    }

    const playerRes = await pool.query('SELECT on_planet_id FROM players WHERE id = $1', [
        playerId,
    ]);
    if (playerRes.rows[0]?.on_planet_id) {
        send(ws, { type: ServerMsgType.Error, message: 'Cannot use this command while on a planet' });
        return;
    }

    // Check has hyperwarp drive
    const shipRes = await pool.query(
        'SELECT has_hyperwarp_drive, turns_per_warp FROM player_ships WHERE player_id = $1',
        [playerId],
    );
    if (shipRes.rows.length === 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Ship not found' });
        return;
    }
    if (!shipRes.rows[0].has_hyperwarp_drive) {
        send(ws, { type: ServerMsgType.Error, message: 'Hyperwarp drive not equipped' });
        return;
    }

    const universeId = player.universeId;

    // Check fighters in target sector
    const fighterRes = await pool.query(
        'SELECT quantity FROM sector_fighters WHERE sector_id = $1 AND universe_id = $2 AND owner_id = $3 AND quantity > 0',
        [targetSector, universeId, playerId],
    );
    if (fighterRes.rows.length === 0) {
        send(ws, { type: ServerMsgType.Error, message: 'No signal from fighters in target sector' });
        return;
    }

    // BFS shortest path
    const warps = await getGraph(universeId);
    const currentSector = player.sector;

    if (currentSector === targetSector) {
        send(ws, {
            type: ServerMsgType.HyperspaceJumpResult,
            targetSector,
            fuelUsed: 0,
            turnsUsed: 0,
        });
        return;
    }

    const queue: { sector: number; hops: number }[] = [{ sector: currentSector, hops: 0 }];
    const visited = new Set<number>();
    visited.add(currentSector);
    let pathHops = -1;

    while (queue.length > 0) {
        const { sector, hops } = queue.shift()!;
        const neighbors = warps[sector] || [];
        for (const neighbor of neighbors) {
            if (neighbor === targetSector) {
                pathHops = hops + 1;
                break;
            }
            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push({ sector: neighbor, hops: hops + 1 });
            }
        }
        if (pathHops >= 0) break;
    }

    if (pathHops < 0) {
        send(ws, { type: ServerMsgType.Error, message: 'No path to target sector' });
        return;
    }

    const fuelCost = pathHops * 3;

    // Check fuel
    const cargoRes = await pool.query('SELECT fuel FROM ship_cargo WHERE player_id = $1', [
        playerId,
    ]);
    if (cargoRes.rows.length === 0 || cargoRes.rows[0].fuel < fuelCost) {
        send(ws, { type: ServerMsgType.Error, message: 'Insufficient fuel for hyperspace jump' });
        return;
    }

    // Check turns
    const turnsPerWarp = shipRes.rows[0].turns_per_warp;
    const turnResult = await checkAndDeductTurns(playerId, universeId, turnsPerWarp);
    if (!turnResult.allowed) {
        send(ws, { type: ServerMsgType.Error, message: 'Insufficient turns' });
        return;
    }

    // Deduct fuel and move
    await pool.query('UPDATE ship_cargo SET fuel = fuel - $1 WHERE player_id = $2', [
        fuelCost,
        playerId,
    ]);
    player.sector = targetSector;
    await Promise.all([
        pool.query('UPDATE players SET current_sector = $1 WHERE id = $2', [
            targetSector,
            playerId,
        ]),
        pool.query(
            'INSERT INTO visited_sectors (player_id, sector_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [playerId, targetSector],
        ),
    ]);

    send(ws, {
        type: ServerMsgType.HyperspaceJumpResult,
        targetSector,
        fuelUsed: fuelCost,
        turnsUsed: turnResult.turnsUsed,
    });
}

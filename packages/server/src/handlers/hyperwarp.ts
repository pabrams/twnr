import { ServerMsgType } from '@twnr/shared';
import { players, sendEnvelope, getGraph, resolveSectorId } from '../game-state.js';
import { pool } from '../db/index.js';
import { checkAndDeductTurns } from '../turn-logic.js';

export async function handleBuyHyperwarpDrive(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (!player.at_starbase) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Not at Starbase' });
        return;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const shipRes = await client.query(
            `SELECT s.id as ship_id, st.name as ship_name, s.has_hyperwarp_drive, st.can_have_hyperwarp, s.turns_per_warp
             FROM ships s JOIN ship_types st ON s.ship_type_id = st.id
             WHERE s.id = (SELECT ship_id FROM players WHERE id = $1) FOR UPDATE OF s`,
            [playerId],
        );
        if (shipRes.rows.length === 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Ship not found' });
            return;
        }

        if (!shipRes.rows[0].can_have_hyperwarp) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, {
                type: ServerMsgType.Error,
                message: 'Ship incapable of hyperwarp drive',
            });
            return;
        }

        if (shipRes.rows[0].has_hyperwarp_drive) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, {
                type: ServerMsgType.Error,
                message: 'Ship already has hyperwarp drive',
            });
            return;
        }

        const cargoRes = await client.query(
            'SELECT credits FROM players WHERE id = $1 FOR UPDATE',
            [playerId],
        );
        if (cargoRes.rows.length === 0 || cargoRes.rows[0].credits < 50000) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Insufficient credits' });
            return;
        }

        await client.query(
            'UPDATE ships SET has_hyperwarp_drive = TRUE WHERE id = $1',
            [shipRes.rows[0].ship_id],
        );
        await client.query('UPDATE players SET credits = credits - 50000 WHERE id = $1', [
            playerId,
        ]);
        await client.query('COMMIT');

        sendEnvelope(playerId, {
            type: ServerMsgType.BuyHyperwarpDriveResult,
            credits: cargoRes.rows[0].credits - 50000,
        });
    } catch {
        await client.query('ROLLBACK');
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
    }
}

export async function handleListDeployedDrones(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (player.docked || player.at_starbase) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'Cannot use this command while docked',
        });
        return;
    }

    const playerRes = await pool.query('SELECT on_planet_id FROM players WHERE id = $1', [
        playerId,
    ]);
    if (playerRes.rows[0]?.on_planet_id) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'Cannot use this command while on a planet',
        });
        return;
    }

    const res = await pool.query(
        `SELECT s.sector_number as sector_id, sf.quantity
         FROM sector_drones sf
         JOIN sectors s ON sf.sector_id = s.id
         WHERE sf.owner_id = $1 AND sf.quantity > 0`,
        [playerId],
    );

    sendEnvelope(playerId, {
        type: ServerMsgType.ListDeployedDronesResult,
        drones: res.rows.map((r: any) => ({ sectorId: r.sector_id, quantity: r.quantity })),
    });
}

export async function handleHyperspaceJump(playerId: number, targetSector: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (player.docked || player.at_starbase) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'Cannot use this command while docked',
        });
        return;
    }

    const playerRes = await pool.query('SELECT on_planet_id FROM players WHERE id = $1', [
        playerId,
    ]);
    if (playerRes.rows[0]?.on_planet_id) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'Cannot use this command while on a planet',
        });
        return;
    }

    // Check has hyperwarp drive
    const shipRes = await pool.query(
        `SELECT s.id as ship_id, s.has_hyperwarp_drive, s.turns_per_warp
         FROM ships s JOIN players p ON p.ship_id = s.id
         WHERE p.id = $1`,
        [playerId],
    );
    if (shipRes.rows.length === 0) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Ship not found' });
        return;
    }
    if (!shipRes.rows[0].has_hyperwarp_drive) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'Hyperwarp drive not equipped',
        });
        return;
    }

    const universeId = player.universeId;

    // Check drones in target sector
    const droneRes = await pool.query(
        `SELECT sf.quantity FROM sector_drones sf
         JOIN sectors s ON sf.sector_id = s.id
         WHERE s.sector_number = $1 AND s.universe_id = $2 AND sf.owner_id = $3 AND sf.quantity > 0`,
        [targetSector, universeId, playerId],
    );
    if (droneRes.rows.length === 0) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'No signal from drones in target sector',
        });
        return;
    }

    // BFS shortest path
    const warps = await getGraph(universeId);
    const currentSector = player.sector;

    if (currentSector === targetSector) {
        sendEnvelope(playerId, {
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
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'No path to target sector' });
        return;
    }

    const fuelCost = pathHops * 3;

    // Check fuel
    const cargoRes = await pool.query(
        'SELECT fuel FROM ships WHERE id = (SELECT ship_id FROM players WHERE id = $1)',
        [playerId],
    );
    if (cargoRes.rows.length === 0 || cargoRes.rows[0].fuel < fuelCost) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'Insufficient fuel for hyperspace jump',
        });
        return;
    }

    // Check turns
    const turnsPerWarp = shipRes.rows[0].turns_per_warp;
    const turnResult = await checkAndDeductTurns(playerId, universeId, turnsPerWarp);
    if (!turnResult.allowed) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Insufficient turns' });
        return;
    }

    // Deduct fuel and move
    const targetSectorId = await resolveSectorId(targetSector, universeId);
    await pool.query(
        'UPDATE ships SET fuel = fuel - $1, sector_id = $2 WHERE id = $3',
        [fuelCost, targetSectorId, shipRes.rows[0].ship_id],
    );
    player.sector = targetSector;
    player.sectorId = targetSectorId;
    await Promise.all([
        pool.query('UPDATE players SET current_sector_id = $1 WHERE id = $2', [
            targetSectorId,
            playerId,
        ]),
        pool.query(
            'INSERT INTO visited_sectors (player_id, sector_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [playerId, targetSector],
        ),
    ]);

    sendEnvelope(playerId, {
        type: ServerMsgType.HyperspaceJumpResult,
        targetSector,
        fuelUsed: fuelCost,
        turnsUsed: turnResult.turnsUsed,
    });
}

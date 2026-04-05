import { WebSocket } from 'ws';
import { ServerMsgType } from '@twnr/shared';
import { players, send } from '../game-state.js';
import { pool } from '../db/index.js';
import { handleSectorDisplay } from './movement.js';
import { planetConfigs } from '../planet-config.js';

export async function handleLand(ws: WebSocket, playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (player.pendingEncounter) {
        send(ws, { type: ServerMsgType.Error, message: 'Resolve fighter encounter first' });
        return;
    }

    const planetRes = await pool.query(
        'SELECT id, name, type FROM planets WHERE sector_id = $1 AND universe_id = $2 ORDER BY id',
        [player.sector, player.universeId],
    );

    send(ws, {
        type: ServerMsgType.PlanetList,
        planets: planetRes.rows,
    });
}

export async function handleLandOnPlanet(ws: WebSocket, playerId: number, planetId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (player.pendingEncounter) {
        send(ws, { type: ServerMsgType.Error, message: 'Resolve fighter encounter first' });
        return;
    }

    const planetRes = await pool.query(
        'SELECT * FROM planets WHERE id = $1 AND sector_id = $2 AND universe_id = $3',
        [planetId, player.sector, player.universeId]
    );

    if (planetRes.rows.length === 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Planet not found in this sector' });
        return;
    }

    if (player.docked) {
        player.docked = false;
        await pool.query('UPDATE players SET docked = FALSE WHERE id = $1', [playerId]);
    }

    await pool.query('UPDATE players SET on_planet_id = $1 WHERE id = $2', [planetId, playerId]);
    
    handlePlanetDisplay(ws, playerId);
}

export async function handlePlanetDisplay(ws: WebSocket, playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const playerRes = await pool.query('SELECT on_planet_id FROM players WHERE id = $1', [playerId]);
    const onPlanetId = playerRes.rows[0]?.on_planet_id;

    if (!onPlanetId) {
        send(ws, { type: ServerMsgType.Error, message: 'Not on a planet' });
        return;
    }

    const planetRes = await pool.query(
        'SELECT id, sector_id, name, type, fighters, fuel, organics, equipment, colonists_fuel, colonists_organics, colonists_equipment, created_at, updated_at FROM planets WHERE id = $1 AND universe_id = $2',
        [onPlanetId, player.universeId]
    );

    if (planetRes.rows.length === 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Planet no longer exists' });
        return;
    }

    const { type: planetType, ...rest } = planetRes.rows[0];

    send(ws, {
        type: ServerMsgType.PlanetDisplayResult,
        planetType,
        ...rest
    });
}

export async function handleLeavePlanet(ws: WebSocket, playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    await pool.query('UPDATE players SET on_planet_id = NULL WHERE id = $1', [playerId]);
    handleSectorDisplay(ws, playerId);
}

export async function handleDestroyPlanet(ws: WebSocket, playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const playerRes = await pool.query('SELECT on_planet_id FROM players WHERE id = $1', [playerId]);
    const onPlanetId = playerRes.rows[0]?.on_planet_id;

    if (!onPlanetId) {
        send(ws, { type: ServerMsgType.Error, message: 'Not on a planet' });
        return;
    }

    const shipRes = await pool.query('SELECT planet_busters FROM player_ships WHERE player_id = $1 FOR UPDATE', [playerId]);
    if (shipRes.rows.length === 0 || shipRes.rows[0].planet_busters < 1) {
        send(ws, { type: ServerMsgType.Error, message: 'You do not have a planet buster.' });
        return;
    }

    const planetRes = await pool.query('SELECT name FROM planets WHERE id = $1 AND universe_id = $2', [onPlanetId, player.universeId]);
    if (planetRes.rows.length === 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Planet not found.' });
        return;
    }
    const planetName = planetRes.rows[0].name;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        await client.query('UPDATE player_ships SET planet_busters = planet_busters - 1 WHERE player_id = $1', [playerId]);
        await client.query('UPDATE players SET on_planet_id = NULL WHERE id = $1', [playerId]);
        await client.query('DELETE FROM planets WHERE id = $1 AND universe_id = $2', [onPlanetId, player.universeId]);
        
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Destroy planet error', err);
        send(ws, { type: ServerMsgType.Error, message: 'Failed to destroy planet.' });
        return;
    } finally {
        client.release();
    }

    send(ws, {
        type: ServerMsgType.DestroyPlanetResult,
        destroyed: true,
        planetId: onPlanetId,
        planetName
    });

    handleSectorDisplay(ws, playerId);
}

export async function handleUseTerraformDevice(ws: WebSocket, playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const sectorId = player.sector;
    const universeId = player.universeId;

    if (player.pendingEncounter) {
        send(ws, { type: ServerMsgType.Error, message: 'Resolve fighter encounter first' });
        return;
    }

    const sectorRes = await pool.query('SELECT name FROM sectors WHERE id = $1 AND universe_id = $2', [sectorId, universeId]);
    const sectorName = sectorRes.rows[0]?.name;

    if (sectorId === 1 || sectorName === 'Stardock') {
        send(ws, { type: ServerMsgType.TerraformResult, success: false, reason: 'restricted_sector' });
        return;
    }

    const shipRes = await pool.query('SELECT terraform_devices FROM player_ships WHERE player_id = $1 FOR UPDATE', [playerId]);
    if (shipRes.rows.length === 0 || shipRes.rows[0].terraform_devices < 1) {
        send(ws, { type: ServerMsgType.TerraformResult, success: false, reason: 'no_devices', terraformDevices: 0 });
        return;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const univRes = await client.query('SELECT max_planets_per_sector, planet_collision_likelihood, planet_collision_min_hours, planet_collision_max_hours FROM universes WHERE id = $1', [universeId]);
        const universeInfo = univRes.rows[0];

        const planetsRes = await client.query('SELECT id FROM planets WHERE sector_id = $1 AND universe_id = $2 FOR UPDATE', [sectorId, universeId]);
        
        await client.query('UPDATE player_ships SET terraform_devices = terraform_devices - 1 WHERE player_id = $1', [playerId]);

        const maxIdRes = await client.query('SELECT COALESCE(MAX(id), 0) as max_id FROM planets WHERE universe_id = $1', [universeId]);
        const newPlanetId = parseInt(maxIdRes.rows[0].max_id, 10) + 1;

        const types = Object.keys(planetConfigs);
        const randomType = types[Math.floor(Math.random() * types.length)] || 'Terran';
        const randomName = 'Planet-' + Math.random().toString(36).substring(2, 8).toUpperCase();

        await client.query(
            'INSERT INTO planets (id, sector_id, universe_id, name, type) VALUES ($1, $2, $3, $4, $5)',
            [newPlanetId, sectorId, universeId, randomName, randomType]
        );

        let collision = false;
        if (planetsRes.rows.length >= universeInfo.max_planets_per_sector) {
            const rand = Math.floor(Math.random() * 100) + 1;
            if (rand <= universeInfo.planet_collision_likelihood) {
                collision = true;
                const collidingWithId = planetsRes.rows[Math.floor(Math.random() * planetsRes.rows.length)].id;
                
                const minH = universeInfo.planet_collision_min_hours;
                const maxH = universeInfo.planet_collision_max_hours;
                const hours = Math.floor(Math.random() * (maxH - minH + 1)) + minH;
                
                await client.query(
                    `INSERT INTO planet_collisions (collision_planet, colliding_with, universe_id, collision_at) 
                     VALUES ($1, $2, $3, NOW() + interval '${hours} hours')`,
                    [newPlanetId, collidingWithId, universeId]
                );
            }
        }

        await client.query('COMMIT');

        send(ws, {
            type: ServerMsgType.TerraformResult,
            success: true,
            planet: { id: newPlanetId, name: randomName, type: randomType, sectorId },
            collision,
            terraformDevices: shipRes.rows[0].terraform_devices - 1
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Use terraform device error', err);
        send(ws, { type: ServerMsgType.Error, message: 'Failed to use terraform device.' });
    } finally {
        client.release();
    }
}

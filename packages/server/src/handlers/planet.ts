import { ServerMsgType } from '@twnr/shared';
import {
    players,
    sendEnvelope,
    getPortForSector,
    getWarpRefs,
    getSectorDrones,
    setPlayerMenu,
} from '../game-state.js';
import { pool } from '../db/index.js';
import { planetConfigs } from '../planet-config.js';
import { checkAndDeductTurns } from '../turn-logic.js';

export async function handleLand(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (player.pendingEncounter) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'Resolve drone encounter first',
        });
        return;
    }

    // Special behavior for sector 1: auto-land on Earth
    if (player.sector === 1) {
        const earthRes = await pool.query(
            `SELECT pl.id FROM planets pl
             JOIN sectors s ON pl.sector_id = s.id
             WHERE s.sector_number = 1 AND s.universe_id = $1 AND pl.name = 'Earth'
             LIMIT 1`,
            [player.universeId],
        );
        if (earthRes.rows.length > 0) {
            return handleLandOnPlanet(playerId, earthRes.rows[0].id);
        }
    }

    const planetRes = await pool.query(
        `SELECT pl.id, pl.name, pl.type FROM planets pl
         JOIN sectors s ON pl.sector_id = s.id
         WHERE s.sector_number = $1 AND s.universe_id = $2 ORDER BY pl.id`,
        [player.sector, player.universeId],
    );

    if (planetRes.rows.length > 0) {
        await setPlayerMenu(playerId, 'planetSelect');
    }
    sendEnvelope(playerId, {
        type: ServerMsgType.LandResult,
        planets: planetRes.rows,
    });
}

export async function handleLandOnPlanet(playerId: number, planetId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (player.pendingEncounter) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'Resolve drone encounter first',
        });
        return;
    }

    const planetRes = await pool.query(
        `SELECT pl.* FROM planets pl
         JOIN sectors s ON pl.sector_id = s.id
         WHERE pl.id = $1 AND s.sector_number = $2 AND s.universe_id = $3`,
        [planetId, player.sector, player.universeId],
    );

    if (planetRes.rows.length === 0) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'Planet not found in this sector',
        });
        return;
    }

    if (player.docked) {
        player.docked = false;
        await pool.query('UPDATE players SET docked = FALSE WHERE id = $1', [playerId]);
    }

    await pool.query('UPDATE players SET on_planet_id = $1 WHERE id = $2', [planetId, playerId]);

    // Use special menu for Earth in sector 1
    const isEarth = player.sector === 1 && planetRes.rows[0].name === 'Earth';
    await setPlayerMenu(playerId, isEarth ? 'planetEarth' : 'planet');

    const data = await queryPlanetDisplayData(playerId);
    if (!data) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Planet no longer exists' });
        return;
    }
    sendEnvelope(playerId, { type: ServerMsgType.LandOnPlanetResult, ...data });
}

export async function handlePlanetDisplay(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const playerRes = await pool.query('SELECT on_planet_id FROM players WHERE id = $1', [
        playerId,
    ]);
    if (!playerRes.rows[0]?.on_planet_id) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Not on a planet' });
        return;
    }

    const data = await queryPlanetDisplayData(playerId);
    if (!data) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Planet no longer exists' });
        return;
    }
    sendEnvelope(playerId, { type: ServerMsgType.PlanetDisplayResult, ...data });
}

async function queryPlanetDisplayData(playerId: number) {
    const player = players[playerId];
    if (!player) return null;

    const playerRes = await pool.query('SELECT on_planet_id FROM players WHERE id = $1', [
        playerId,
    ]);
    const onPlanetId = playerRes.rows[0]?.on_planet_id;
    if (!onPlanetId) return null;

    const planetRes = await pool.query(
        'SELECT id, sector_id, name, type, drones, fuel, organics, equipment, colonists_fuel, colonists_organics, colonists_equipment, created_at, updated_at FROM planets WHERE id = $1',
        [onPlanetId],
    );
    if (planetRes.rows.length === 0) return null;

    const { type: planetType, ...rest } = planetRes.rows[0];
    return { planetType, ...rest };
}

async function buildSectorDisplayData(playerId: number) {
    const player = players[playerId];
    if (!player) return null;
    const currentSector = player.sector;
    const universeId = player.universeId;

    const [port, warpRefs, sectorDrones, planetsRes] = await Promise.all([
        getPortForSector(currentSector, universeId),
        getWarpRefs(playerId, currentSector, universeId),
        getSectorDrones(currentSector, universeId),
        pool.query(
            `SELECT pl.id, pl.name, pl.type FROM planets pl
             JOIN sectors s ON pl.sector_id = s.id
             WHERE s.sector_number = $1 AND s.universe_id = $2 ORDER BY pl.id`,
            [currentSector, universeId],
        ),
    ]);

    // Query upcoming collisions for planets in this sector
    const collisionsRes = await pool.query(
        `SELECT p1.name as planet_name, p2.name as colliding_with_name, pc.collision_at
         FROM planet_collisions pc
         JOIN planets p1 ON pc.collision_planet = p1.id
         JOIN planets p2 ON pc.colliding_with = p2.id
         JOIN sectors s ON p1.sector_id = s.id
         WHERE s.sector_number = $1 AND s.universe_id = $2
           AND pc.collision_at > NOW()`,
        [currentSector, universeId],
    );

    const playersInSector = Object.entries(players)
        .filter(
            ([id, p]) =>
                p.sector === currentSector &&
                p.universeId === universeId &&
                !p.docked &&
                Number(id) !== playerId,
        )
        .map(([id, p]) => ({ id: Number(id), name: p.name }));

    return {
        sector: currentSector,
        warps: warpRefs,
        players: playersInSector,
        port,
        sectorDrones,
        planets: planetsRes.rows,
        collisions: collisionsRes.rows.map((r: any) => ({
            planetName: r.planet_name,
            collidingWithName: r.colliding_with_name,
            collisionAt: r.collision_at,
        })),
    };
}

export async function handleLeavePlanet(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const turnResult = await checkAndDeductTurns(playerId, player.universeId, 1);
    if (!turnResult.allowed) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Insufficient turns' });
        return;
    }

    await pool.query('UPDATE players SET on_planet_id = NULL WHERE id = $1', [playerId]);
    await setPlayerMenu(playerId, 'sector');

    const data = await buildSectorDisplayData(playerId);
    if (!data) return;
    sendEnvelope(playerId, {
        type: ServerMsgType.LeavePlanetResult,
        ...data,
        turnsUsed: turnResult.turnsUsed,
    });
}

export async function handleDestroyPlanet(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const playerRes = await pool.query('SELECT on_planet_id FROM players WHERE id = $1', [
        playerId,
    ]);
    const onPlanetId = playerRes.rows[0]?.on_planet_id;

    if (!onPlanetId) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Not on a planet' });
        return;
    }

    const shipRes = await pool.query(
        'SELECT planet_busters FROM ships WHERE id = (SELECT ship_id FROM players WHERE id = $1) FOR UPDATE',
        [playerId],
    );
    if (shipRes.rows.length === 0 || shipRes.rows[0].planet_busters < 1) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'You do not have a planet buster.',
        });
        return;
    }

    const planetRes = await pool.query('SELECT name FROM planets WHERE id = $1', [onPlanetId]);
    if (planetRes.rows.length === 0) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Planet not found.' });
        return;
    }
    const planetName = planetRes.rows[0].name;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        await client.query(
            'UPDATE ships SET planet_busters = planet_busters - 1 WHERE id = (SELECT ship_id FROM players WHERE id = $1)',
            [playerId],
        );
        await client.query('UPDATE players SET on_planet_id = NULL WHERE id = $1', [playerId]);
        await client.query('DELETE FROM planets WHERE id = $1', [onPlanetId]);

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Destroy planet error', err);
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Failed to destroy planet.' });
        return;
    } finally {
        client.release();
    }

    await setPlayerMenu(playerId, 'sector');
    sendEnvelope(playerId, {
        type: ServerMsgType.DestroyPlanetResult,
        destroyed: true,
        planetId: onPlanetId,
        planetName,
    });

    // Follow up with sector display so client sees updated sector
    const data = await buildSectorDisplayData(playerId);
    if (data) sendEnvelope(playerId, { type: ServerMsgType.SectorDisplayResult, ...data });
}

export async function handleUseTerraformDevice(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const sectorId = player.sector;
    const universeId = player.universeId;

    if (player.pendingEncounter) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'Resolve drone encounter first',
        });
        return;
    }

    const sectorRes = await pool.query(
        'SELECT id, name FROM sectors WHERE sector_number = $1 AND universe_id = $2',
        [sectorId, universeId],
    );
    const sectorName = sectorRes.rows[0]?.name;
    const sectorDbId = sectorRes.rows[0]?.id;

    if (sectorId === 1 || sectorName === 'Starbase') {
        sendEnvelope(playerId, {
            type: ServerMsgType.UseTerraformDeviceResult,
            success: false,
            reason: 'restricted_sector',
        });
        return;
    }

    const shipRes = await pool.query(
        'SELECT terraform_devices FROM ships WHERE id = (SELECT ship_id FROM players WHERE id = $1) FOR UPDATE',
        [playerId],
    );
    if (shipRes.rows.length === 0 || shipRes.rows[0].terraform_devices < 1) {
        sendEnvelope(playerId, {
            type: ServerMsgType.UseTerraformDeviceResult,
            success: false,
            reason: 'no_devices',
            terraformDevices: 0,
        });
        return;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const univRes = await client.query(
            `SELECT COALESCE(e.max_planets_per_sector, 2) as max_planets_per_sector,
                    COALESCE(e.planet_collision_likelihood, 50) as planet_collision_likelihood,
                    COALESCE(e.planet_collision_min_hours, 24) as planet_collision_min_hours,
                    COALESCE(e.planet_collision_max_hours, 24) as planet_collision_max_hours
             FROM universes u LEFT JOIN edits e ON u.edit_id = e.id WHERE u.id = $1`,
            [universeId],
        );
        const universeInfo = univRes.rows[0];

        const planetsRes = await client.query(
            'SELECT id FROM planets WHERE sector_id = $1 FOR UPDATE',
            [sectorDbId],
        );

        await client.query(
            'UPDATE ships SET terraform_devices = terraform_devices - 1 WHERE id = (SELECT ship_id FROM players WHERE id = $1)',
            [playerId],
        );

        const types = Object.keys(planetConfigs);
        const randomType = types[Math.floor(Math.random() * types.length)] || 'Terran';
        const randomName = 'Planet-' + Math.random().toString(36).substring(2, 8).toUpperCase();

        const insertRes = await client.query(
            'INSERT INTO planets (sector_id, name, type, owner_player_id) VALUES ($1, $2, $3, $4) RETURNING id',
            [sectorDbId, randomName, randomType, playerId],
        );
        const newPlanetId = insertRes.rows[0].id;

        let collision = false;
        if (planetsRes.rows.length >= universeInfo.max_planets_per_sector) {
            const rand = Math.floor(Math.random() * 100) + 1;
            if (rand <= universeInfo.planet_collision_likelihood) {
                collision = true;
                const collidingWithId =
                    planetsRes.rows[Math.floor(Math.random() * planetsRes.rows.length)].id;

                const minH = universeInfo.planet_collision_min_hours;
                const maxH = universeInfo.planet_collision_max_hours;
                const hours = Math.floor(Math.random() * (maxH - minH + 1)) + minH;

                await client.query(
                    `INSERT INTO planet_collisions (collision_planet, colliding_with, collision_at)
                     VALUES ($1, $2, NOW() + interval '${hours} hours')`,
                    [newPlanetId, collidingWithId],
                );
            }
        }

        await client.query('COMMIT');

        sendEnvelope(playerId, {
            type: ServerMsgType.UseTerraformDeviceResult,
            success: true,
            planet: { id: newPlanetId, name: randomName, type: randomType, sectorId },
            collision,
            terraformDevices: shipRes.rows[0].terraform_devices - 1,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Use terraform device error', err);
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'Failed to use terraform device.',
        });
    } finally {
        client.release();
    }
}

const COLONIST_COLUMNS = {
    fuel: 'colonists_fuel',
    organics: 'colonists_organics',
    equipment: 'colonists_equipment',
} as const;

export async function handleTakeColonists(
    playerId: number,
    quantity: number,
    commodity: string,
): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const col = COLONIST_COLUMNS[commodity as keyof typeof COLONIST_COLUMNS];
    if (!col) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Invalid commodity' });
        return;
    }

    const playerRes = await pool.query('SELECT on_planet_id FROM players WHERE id = $1', [
        playerId,
    ]);
    const onPlanetId = playerRes.rows[0]?.on_planet_id;
    if (!onPlanetId) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Not on a planet' });
        return;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const planetRes = await client.query(
            `SELECT ${col} as available FROM planets WHERE id = $1 FOR UPDATE`,
            [onPlanetId],
        );
        if (planetRes.rows.length === 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Planet not found' });
            return;
        }

        const available = planetRes.rows[0].available;
        const actual = Math.min(quantity, available);
        if (actual <= 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, {
                type: ServerMsgType.Error,
                message: 'No colonists available to take',
            });
            return;
        }

        // Check ship holds
        const shipRes = await client.query(
            `SELECT s.holds, s.fuel, s.organics, s.equipment, s.colonists
             FROM ships s WHERE s.id = (SELECT ship_id FROM players WHERE id = $1) FOR UPDATE`,
            [playerId],
        );
        if (shipRes.rows.length === 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'No ship' });
            return;
        }
        const ship = shipRes.rows[0];
        const used = ship.fuel + ship.organics + ship.equipment + ship.colonists;
        const free = ship.holds - used;
        const toTake = Math.min(actual, free);
        if (toTake <= 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'No free holds' });
            return;
        }

        await client.query(`UPDATE planets SET ${col} = ${col} - $1 WHERE id = $2`, [
            toTake,
            onPlanetId,
        ]);
        await client.query(
            'UPDATE ships SET colonists = colonists + $1 WHERE id = (SELECT ship_id FROM players WHERE id = $2)',
            [toTake, playerId],
        );

        await client.query('COMMIT');

        const updatedPlanet = await pool.query(
            `SELECT ${col} as remaining FROM planets WHERE id = $1`,
            [onPlanetId],
        );

        const updatedShip = await pool.query(
            'SELECT colonists FROM ships WHERE id = (SELECT ship_id FROM players WHERE id = $1)',
            [playerId],
        );

        sendEnvelope(playerId, {
            type: ServerMsgType.TakeColonistsResult,
            quantity: toTake,
            commodity: commodity as 'fuel' | 'organics' | 'equipment',
            planetColonists: updatedPlanet.rows[0].remaining,
            shipColonists: updatedShip.rows[0].colonists,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Take colonists error', err);
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Failed to take colonists' });
    } finally {
        client.release();
    }
}

export async function handleLeaveColonists(
    playerId: number,
    quantity: number,
    commodity: string,
): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const col = COLONIST_COLUMNS[commodity as keyof typeof COLONIST_COLUMNS];
    if (!col) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Invalid commodity' });
        return;
    }

    const playerRes = await pool.query('SELECT on_planet_id FROM players WHERE id = $1', [
        playerId,
    ]);
    const onPlanetId = playerRes.rows[0]?.on_planet_id;
    if (!onPlanetId) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Not on a planet' });
        return;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const shipRes = await client.query(
            'SELECT colonists FROM ships WHERE id = (SELECT ship_id FROM players WHERE id = $1) FOR UPDATE',
            [playerId],
        );
        if (shipRes.rows.length === 0 || shipRes.rows[0].colonists <= 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, {
                type: ServerMsgType.Error,
                message: 'No colonists on ship',
            });
            return;
        }

        const actual = Math.min(quantity, shipRes.rows[0].colonists);

        await client.query(
            'UPDATE ships SET colonists = colonists - $1 WHERE id = (SELECT ship_id FROM players WHERE id = $2)',
            [actual, playerId],
        );
        await client.query(`UPDATE planets SET ${col} = ${col} + $1 WHERE id = $2`, [
            actual,
            onPlanetId,
        ]);

        await client.query('COMMIT');

        const updatedPlanet = await pool.query(
            `SELECT ${col} as remaining FROM planets WHERE id = $1`,
            [onPlanetId],
        );

        const updatedShip = await pool.query(
            'SELECT colonists FROM ships WHERE id = (SELECT ship_id FROM players WHERE id = $1)',
            [playerId],
        );

        sendEnvelope(playerId, {
            type: ServerMsgType.LeaveColonistsResult,
            quantity: actual,
            commodity: commodity as 'fuel' | 'organics' | 'equipment',
            planetColonists: updatedPlanet.rows[0].remaining,
            shipColonists: updatedShip.rows[0].colonists,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Leave colonists error', err);
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'Failed to leave colonists',
        });
    } finally {
        client.release();
    }
}

export async function handleListPlanets(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const res = await pool.query(
        `SELECT p.id, s.sector_number, p.name, p.type,
                p.fuel, p.organics, p.equipment,
                p.colonists_fuel, p.colonists_organics, p.colonists_equipment
         FROM planets p
         JOIN sectors s ON p.sector_id = s.id
         WHERE p.owner_player_id = $1 AND s.universe_id = $2
         ORDER BY s.sector_number, p.id`,
        [playerId, player.universeId],
    );

    sendEnvelope(playerId, {
        type: ServerMsgType.ListPlanetsResult,
        planets: res.rows.map((r: any) => ({
            id: r.id,
            sectorNumber: r.sector_number,
            name: r.name,
            type: r.type,
            fuel: r.fuel,
            organics: r.organics,
            equipment: r.equipment,
            colonists_fuel: r.colonists_fuel,
            colonists_organics: r.colonists_organics,
            colonists_equipment: r.colonists_equipment,
        })),
    });
}

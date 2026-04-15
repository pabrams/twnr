import { ServerMsgType } from '@twnr/shared';
import { players, sendEnvelope, buildSectorDisplayData, setPlayerMenu } from '../game-state.js';
import { pool } from '../db/index.js';
import type { PlayerPlanetRow } from '../db/types.js';
import {
    getEarthId,
    getPlanetInSector,
    getPlanetDisplayData,
    getPlanetName,
} from '../db/queries/planet.js';
import { getPlanetsInSector } from '../db/queries/sector.js';
import { getOnPlanetId, setDocked, setOnPlanet } from '../db/queries/player.js';
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
        const earthId = await getEarthId(player.universeId);
        if (earthId) {
            return handleLandOnPlanet(playerId, earthId);
        }
    }

    const planets = await getPlanetsInSector(player.sector, player.universeId);

    if (planets.length > 0) {
        await setPlayerMenu(playerId, 'planetSelect');
    }
    sendEnvelope(playerId, {
        type: ServerMsgType.LandResult,
        planets,
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

    const planet = await getPlanetInSector(planetId, player.sector, player.universeId);
    if (!planet) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'Planet not found in this sector',
        });
        return;
    }

    if (player.docked) {
        player.docked = false;
        await setDocked(playerId, false);
    }

    await setOnPlanet(playerId, planetId);

    // Use special menu for Earth in sector 1
    const isEarth = player.sector === 1 && planet.name === 'Earth';
    await setPlayerMenu(playerId, isEarth ? 'planetEarth' : 'planet');

    const data = await getPlanetDisplayData(playerId);
    if (!data) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Planet no longer exists' });
        return;
    }
    sendEnvelope(playerId, { type: ServerMsgType.LandOnPlanetResult, ...data });
}

export async function handlePlanetDisplay(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Not on a planet' });
        return;
    }

    const data = await getPlanetDisplayData(playerId);
    if (!data) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Planet no longer exists' });
        return;
    }
    sendEnvelope(playerId, { type: ServerMsgType.PlanetDisplayResult, ...data });
}

export async function handleLeavePlanet(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const turnResult = await checkAndDeductTurns(playerId, player.universeId, 1);
    if (!turnResult.allowed) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Insufficient turns' });
        return;
    }

    await setOnPlanet(playerId, null);
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

    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Not on a planet' });
        return;
    }

    const shipRes = await pool.query(
        `SELECT sh.quantity FROM ship_hardware sh
         JOIN hardware_item hi ON hi.id = sh.hardware_item_id
         WHERE hi.name = 'planet_buster' AND sh.ship_id = (SELECT ship_id FROM players WHERE id = $1)`,
        [playerId],
    );
    if (shipRes.rows.length === 0 || shipRes.rows[0].quantity < 1) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'You do not have a planet buster.',
        });
        return;
    }

    const planetName = await getPlanetName(onPlanetId);
    if (!planetName) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Planet not found.' });
        return;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        await client.query(
            `UPDATE ship_hardware SET quantity = quantity - 1
             WHERE hardware_item_id = (SELECT id FROM hardware_item WHERE name = 'planet_buster')
             AND ship_id = (SELECT ship_id FROM players WHERE id = $1)`,
            [playerId],
        );
        await setOnPlanet(playerId, null, client);
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
        `SELECT COALESCE(sh.quantity, 0) as quantity FROM ships s
         LEFT JOIN ship_hardware sh ON sh.ship_id = s.id
           AND sh.hardware_item_id = (SELECT id FROM hardware_item WHERE name = 'terraform_device')
         WHERE s.id = (SELECT ship_id FROM players WHERE id = $1)`,
        [playerId],
    );
    if (shipRes.rows.length === 0 || shipRes.rows[0].quantity < 1) {
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
            `UPDATE ship_hardware SET quantity = quantity - 1
             WHERE hardware_item_id = (SELECT id FROM hardware_item WHERE name = 'terraform_device')
             AND ship_id = (SELECT ship_id FROM players WHERE id = $1)`,
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
            terraformDevices: shipRes.rows[0].quantity - 1,
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

    const onPlanetId = await getOnPlanetId(playerId);
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
        } else {
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
        }
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Take colonists error', err);
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Failed to take colonists' });
    } finally {
        client.release();
    }

    // Auto-leave planet after taking colonists (success or no-holds)
    await setOnPlanet(playerId, null);
    await setPlayerMenu(playerId, 'sector');
    const sectorData = await buildSectorDisplayData(playerId);
    if (sectorData) {
        sendEnvelope(playerId, { type: ServerMsgType.LeavePlanetResult, ...sectorData });
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

    const onPlanetId = await getOnPlanetId(playerId);
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

    const res = await pool.query<PlayerPlanetRow>(
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
        planets: res.rows.map((r) => ({
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

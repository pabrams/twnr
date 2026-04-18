import { ServerMsgType } from '@twnr/shared';
import { players, sendEnvelope, buildSectorDisplayData, setPlayerMenu } from '../game-state.js';
import { pool } from '../db/index.js';
import {
    getEarthId,
    getPlanetInSector,
    getPlanetDisplayData,
    getPlanetName,
    deletePlanet,
    getSectorByNumber,
    getTerraformConfigForUniverse,
    getPlanetIdsInSectorForUpdate,
    insertPlanet,
    insertPlanetCollision,
    getPlanetColonistsForUpdate,
    updatePlanetColonists,
    getPlanetColonistsRemaining,
    listPlayerPlanets,
    type ColonistCommodity,
} from '../db/queries/planet.js';
import { getPlanetsInSector } from '../db/queries/sector.js';
import { getOnPlanetId, setDocked, setOnPlanet } from '../db/queries/player.js';
import {
    getShipHardwareQuantityByName,
    decrementShipHardwareByName,
} from '../db/queries/hardware.js';
import {
    getShipHoldsAndCargoForUpdate,
    getShipColonistsForUpdate,
    getShipColonists,
    incrementShipColonists,
} from '../db/queries/ship.js';
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

    const busters = await getShipHardwareQuantityByName(playerId, 'planet_buster');
    if (busters < 1) {
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

        await decrementShipHardwareByName(playerId, 'planet_buster', client);
        await setOnPlanet(playerId, null, client);
        await deletePlanet(onPlanetId, client);

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

    const sector = await getSectorByNumber(sectorId, universeId);
    const sectorName = sector?.name;
    const sectorDbId = sector?.id;

    if (sectorId === 1 || sectorName === 'Starbase') {
        sendEnvelope(playerId, {
            type: ServerMsgType.UseTerraformDeviceResult,
            success: false,
            reason: 'restricted_sector',
        });
        return;
    }

    const terraformQty = await getShipHardwareQuantityByName(playerId, 'terraform_device');
    if (terraformQty < 1) {
        sendEnvelope(playerId, {
            type: ServerMsgType.UseTerraformDeviceResult,
            success: false,
            reason: 'no_devices',
            terraformDevices: 0,
        });
        return;
    }

    if (!sectorDbId) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Sector not found' });
        return;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const universeInfo = await getTerraformConfigForUniverse(universeId, client);
        if (!universeInfo) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Universe not found' });
            return;
        }

        const existingPlanetIds = await getPlanetIdsInSectorForUpdate(sectorDbId, client);

        await decrementShipHardwareByName(playerId, 'terraform_device', client);

        const types = Object.keys(planetConfigs);
        const randomType = types[Math.floor(Math.random() * types.length)] || 'Terran';
        const randomName = 'Planet-' + Math.random().toString(36).substring(2, 8).toUpperCase();

        const newPlanetId = await insertPlanet(
            sectorDbId,
            randomName,
            randomType,
            playerId,
            client,
        );

        let collision = false;
        if (existingPlanetIds.length >= universeInfo.max_planets_per_sector) {
            const rand = Math.floor(Math.random() * 100) + 1;
            if (rand <= universeInfo.planet_collision_likelihood) {
                collision = true;
                const collidingWithId =
                    existingPlanetIds[Math.floor(Math.random() * existingPlanetIds.length)];

                const minH = universeInfo.planet_collision_min_hours;
                const maxH = universeInfo.planet_collision_max_hours;
                const hours = Math.floor(Math.random() * (maxH - minH + 1)) + minH;

                await insertPlanetCollision(newPlanetId, collidingWithId, hours, client);
            }
        }

        await client.query('COMMIT');

        sendEnvelope(playerId, {
            type: ServerMsgType.UseTerraformDeviceResult,
            success: true,
            planet: { id: newPlanetId, name: randomName, type: randomType, sectorId },
            collision,
            terraformDevices: terraformQty - 1,
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

export async function handleTakeColonists(
    playerId: number,
    quantity: number,
    commodity: string,
): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (commodity !== 'fuel' && commodity !== 'organics' && commodity !== 'equipment') {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Invalid commodity' });
        return;
    }
    const col = commodity as ColonistCommodity;

    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Not on a planet' });
        return;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const available = await getPlanetColonistsForUpdate(onPlanetId, col, client);
        if (available === undefined) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Planet not found' });
            return;
        }

        const actual = Math.min(quantity, available);
        if (actual <= 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, {
                type: ServerMsgType.Error,
                message: 'No colonists available to take',
            });
            return;
        }

        const ship = await getShipHoldsAndCargoForUpdate(playerId, client);
        if (!ship) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'No ship' });
            return;
        }
        const used = ship.fuel + ship.organics + ship.equipment + ship.colonists;
        const free = ship.holds - used;
        const toTake = Math.min(actual, free);
        if (toTake <= 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'No free holds' });
        } else {
            await updatePlanetColonists(onPlanetId, col, -toTake, client);
            await incrementShipColonists(playerId, toTake, client);
            await client.query('COMMIT');

            const planetRemaining = await getPlanetColonistsRemaining(onPlanetId, col);
            const shipColonists = await getShipColonists(playerId);

            sendEnvelope(playerId, {
                type: ServerMsgType.TakeColonistsResult,
                quantity: toTake,
                commodity: col,
                planetColonists: planetRemaining ?? 0,
                shipColonists: shipColonists ?? 0,
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

    if (commodity !== 'fuel' && commodity !== 'organics' && commodity !== 'equipment') {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Invalid commodity' });
        return;
    }
    const col = commodity as ColonistCommodity;

    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Not on a planet' });
        return;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const shipColonists = await getShipColonistsForUpdate(playerId, client);
        if (shipColonists === undefined || shipColonists <= 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, {
                type: ServerMsgType.Error,
                message: 'No colonists on ship',
            });
            return;
        }

        const actual = Math.min(quantity, shipColonists);

        await incrementShipColonists(playerId, -actual, client);
        await updatePlanetColonists(onPlanetId, col, actual, client);

        await client.query('COMMIT');

        const planetRemaining = await getPlanetColonistsRemaining(onPlanetId, col);
        const shipColonistsNow = await getShipColonists(playerId);

        sendEnvelope(playerId, {
            type: ServerMsgType.LeaveColonistsResult,
            quantity: actual,
            commodity: col,
            planetColonists: planetRemaining ?? 0,
            shipColonists: shipColonistsNow ?? 0,
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

    const rows = await listPlayerPlanets(playerId, player.universeId);

    sendEnvelope(playerId, {
        type: ServerMsgType.ListPlanetsResult,
        planets: rows.map((r) => ({
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

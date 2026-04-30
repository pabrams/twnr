import { ServerMsgType } from '@twnr/shared';
import { players, setPlayerMenu } from '../state/players.js';
import { sendEnvelope, sendError } from '../state/messaging.js';
import { buildSectorDisplayData } from '../services/sector-display.js';
import { withTransaction, AbortTransaction } from '../db/index.js';
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
    getShipCargoWithCredits,
} from '../db/queries/ship.js';
import { planetConfigs } from '../planet-config.js';
import { checkAndDeductTurns } from '../turn-logic.js';
import { cargoUsed } from './cargo-utils.js';

export async function handleLand(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (player.pendingEncounter) {
        sendError(playerId, 'Resolve drone encounter first');
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

    await sendEnvelope(
        playerId,
        { type: ServerMsgType.LandResult, planets },
        planets.length > 0 ? 'planetSelect' : undefined,
    );
}

export async function handleLandOnPlanet(playerId: number, planetId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (player.pendingEncounter) {
        sendError(playerId, 'Resolve drone encounter first');
        return;
    }

    const planet = await getPlanetInSector(planetId, player.sector, player.universeId);
    if (!planet) {
        sendError(playerId, 'Planet not found in this sector');
        return;
    }

    if (player.docked) {
        player.docked = false;
        await setDocked(playerId, false);
    }

    await setOnPlanet(playerId, planetId);

    const isEarth = player.sector === 1 && planet.name === 'Earth';
    const planetMenu = isEarth ? 'planetEarth' : 'planet';

    const data = await getPlanetDisplayData(playerId);
    if (!data) {
        sendError(playerId, 'Planet no longer exists', planetMenu);
        return;
    }
    const [empty_holds, ship_colonists] = await getShipPlanetContext(playerId);
    await sendEnvelope(
        playerId,
        {
            type: ServerMsgType.LandOnPlanetResult,
            ...data,
            empty_holds,
            ship_colonists,
        },
        planetMenu,
    );
}

async function getShipPlanetContext(playerId: number): Promise<[number, number]> {
    const [ship, shipColonists] = await Promise.all([
        getShipCargoWithCredits(playerId),
        getShipColonists(playerId),
    ]);
    const emptyHolds = ship ? Math.max(0, ship.cargo_limit - cargoUsed(ship)) : 0;
    return [emptyHolds, shipColonists ?? 0];
}

export async function handlePlanetDisplay(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        sendError(playerId, 'Not on a planet');
        return;
    }

    const data = await getPlanetDisplayData(playerId);
    if (!data) {
        sendError(playerId, 'Planet no longer exists');
        return;
    }
    const [empty_holds, ship_colonists] = await getShipPlanetContext(playerId);
    sendEnvelope(playerId, {
        type: ServerMsgType.PlanetDisplayResult,
        ...data,
        empty_holds,
        ship_colonists,
    });
}

export async function handleLeavePlanet(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const turnResult = await checkAndDeductTurns(playerId, player.universeId, 1);
    if (!turnResult.allowed) {
        sendError(playerId, 'Insufficient turns');
        return;
    }

    await setOnPlanet(playerId, null);

    const data = await buildSectorDisplayData(playerId);
    if (!data) return;
    await sendEnvelope(
        playerId,
        { type: ServerMsgType.LeavePlanetResult, ...data, turnsUsed: turnResult.turnsUsed },
        'sector',
    );
}

export async function handleDestroyPlanet(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        sendError(playerId, 'Not on a planet');
        return;
    }

    const busters = await getShipHardwareQuantityByName(playerId, 'planet_buster');
    if (busters < 1) {
        sendError(playerId, 'You do not have a planet buster.');
        return;
    }

    const planetName = await getPlanetName(onPlanetId);
    if (!planetName) {
        sendError(playerId, 'Planet not found.');
        return;
    }

    try {
        await withTransaction(async (client) => {
            await decrementShipHardwareByName(playerId, 'planet_buster', client);
            await setOnPlanet(playerId, null, client);
            await deletePlanet(onPlanetId, client);
        });
    } catch (err) {
        console.error('Destroy planet error', err);
        sendError(playerId, 'Failed to destroy planet.');
        return;
    }

    await sendEnvelope(
        playerId,
        {
            type: ServerMsgType.DestroyPlanetResult,
            destroyed: true,
            planetId: onPlanetId,
            planetName,
        },
        'sector',
    );

    const data = await buildSectorDisplayData(playerId);
    if (data) sendEnvelope(playerId, { type: ServerMsgType.SectorDisplayResult, ...data });
}

/**
 * Pre-check for the 'U' command from the sector menu. Returns the device count
 * and whether the player can terraform here. If they can, transitions menu
 * server-side to terraformConfirm so the client can show a Y/N prompt.
 */
export async function handleTerraformInfo(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (player.pendingEncounter) {
        sendError(playerId, 'Resolve drone encounter first');
        return;
    }

    const sectorId = player.sector;
    const universeId = player.universeId;
    const sector = await getSectorByNumber(sectorId, universeId);
    const restricted = sectorId === 1 || sector?.name === 'Starbase';

    if (restricted) {
        sendEnvelope(playerId, {
            type: ServerMsgType.TerraformInfoResult,
            canTerraform: false,
            devices: 0,
            reason: 'restricted_sector',
        });
        return;
    }

    const devices = await getShipHardwareQuantityByName(playerId, 'terraform_device');
    if (devices < 1) {
        sendEnvelope(playerId, {
            type: ServerMsgType.TerraformInfoResult,
            canTerraform: false,
            devices: 0,
            reason: 'no_devices',
        });
        return;
    }

    await sendEnvelope(
        playerId,
        { type: ServerMsgType.TerraformInfoResult, canTerraform: true, devices },
        'terraformConfirm',
    );
}

export async function handleUseTerraformDevice(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const sectorId = player.sector;
    const universeId = player.universeId;

    if (player.pendingEncounter) {
        sendError(playerId, 'Resolve drone encounter first');
        return;
    }

    // We were in terraformConfirm; whatever happens, drop back to the sector menu.
    await setPlayerMenu(playerId, 'sector');

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
        sendError(playerId, 'Sector not found');
        return;
    }

    try {
        const result = await withTransaction(async (client) => {
            const universeInfo = await getTerraformConfigForUniverse(universeId, client);
            if (!universeInfo) {
                sendError(playerId, 'Universe not found');
                throw new AbortTransaction();
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

            return { newPlanetId, randomName, randomType, collision };
        });

        if (!result) return;

        sendEnvelope(playerId, {
            type: ServerMsgType.UseTerraformDeviceResult,
            success: true,
            planet: {
                id: result.newPlanetId,
                name: result.randomName,
                type: result.randomType,
                sectorId,
            },
            collision: result.collision,
            terraformDevices: terraformQty - 1,
        });
    } catch (err) {
        console.error('Use terraform device error', err);
        sendError(playerId, 'Failed to use terraform device.');
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
        sendError(playerId, 'Invalid commodity');
        return;
    }
    const col = commodity as ColonistCommodity;

    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        sendError(playerId, 'Not on a planet');
        return;
    }

    try {
        const toTake = await withTransaction(async (client) => {
            const available = await getPlanetColonistsForUpdate(onPlanetId, col, client);
            if (available === undefined) {
                sendError(playerId, 'Planet not found');
                throw new AbortTransaction();
            }

            // -1 = accept default (take as many as available; clamped by holds below)
            const requested = quantity === -1 ? available : quantity;
            const actual = Math.min(requested, available);
            if (actual <= 0) {
                sendError(playerId, 'No colonists available to take');
                throw new AbortTransaction();
            }

            const ship = await getShipHoldsAndCargoForUpdate(playerId, client);
            if (!ship) {
                sendError(playerId, 'No ship');
                throw new AbortTransaction();
            }
            const used = cargoUsed(ship);
            const free = ship.holds - used;
            const take = Math.min(actual, free);
            if (take <= 0) {
                sendError(playerId, 'No free holds');
                throw new AbortTransaction();
            }

            await updatePlanetColonists(onPlanetId, col, -take, client);
            await incrementShipColonists(playerId, take, client);
            return take;
        });

        if (toTake !== undefined) {
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
        console.error('Take colonists error', err);
        sendError(playerId, 'Failed to take colonists');
    }

    // Auto-leave planet after taking colonists (success or no-holds)
    await setOnPlanet(playerId, null);
    const sectorData = await buildSectorDisplayData(playerId);
    if (sectorData) {
        await sendEnvelope(
            playerId,
            { type: ServerMsgType.LeavePlanetResult, ...sectorData },
            'sector',
        );
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
        sendError(playerId, 'Invalid commodity');
        return;
    }
    const col = commodity as ColonistCommodity;

    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        sendError(playerId, 'Not on a planet');
        return;
    }

    // Return to the planet command menu (Earth menu if on Earth, else regular planet)
    // BEFORE doing the work — any sendError below will then carry the updated menu.
    await setPlayerMenu(playerId, player.sector === 1 ? 'planetEarth' : 'planet');

    try {
        const actual = await withTransaction(async (client) => {
            const shipColonists = await getShipColonistsForUpdate(playerId, client);
            if (shipColonists === undefined || shipColonists <= 0) {
                sendError(playerId, 'No colonists on ship');
                throw new AbortTransaction();
            }

            // -1 = accept default (leave all ship colonists)
            const requested = quantity === -1 ? shipColonists : quantity;
            const leave = Math.min(requested, shipColonists);

            await incrementShipColonists(playerId, -leave, client);
            await updatePlanetColonists(onPlanetId, col, leave, client);
            return leave;
        });

        if (actual === undefined) return;

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
        console.error('Leave colonists error', err);
        sendError(playerId, 'Failed to leave colonists');
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

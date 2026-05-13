import { ServerTag, ClientTag } from '@twnr/shared';
import type {
    LandOnPlanetCommand,
    TakeColonistsCommand,
    LeaveColonistsCommand,
    TakeCommodityCommand,
    LeaveCommodityCommand,
    ClaimPlanetCommand,
} from '@twnr/shared';
import { players } from '../state/players.js';
import { sendEnvelope, sendError } from '../state/messaging.js';
import { buildSectorDisplayData } from '../services/sector-display.js';
import { isInEncounter } from '../services/encounter.js';
import { withTransaction, AbortTransaction } from '../db/index.js';
import {
    getEarthId,
    getPlanetInSector,
    getPlanetDisplayData,
    getPlanetName,
    getPlanetOwnership,
    deletePlanet,
    getSectorByNumber,
    getTerraformConfigForUniverse,
    getPlanetIdsInSectorForUpdate,
    insertPlanet,
    insertPlanetCollision,
    getPlanetColonistsForUpdate,
    updatePlanetColonists,
    getPlanetColonistsRemaining,
    getPlanetColonistsCapacity,
    getPlanetCommodityForUpdate,
    updatePlanetCommodity,
    getPlanetCommodityRemaining,
    getPlanetCommodityCapacity,
    listPlayerPlanets,
    settlePlanetProduction,
    settlePlanetColonistGrowth,
    setPlanetOwnership,
    type ColonistCommodity,
    type PlanetCommodity,
} from '../db/queries/planet.js';
import { getPlayerClanId } from '../db/queries/clan.js';
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
    getShipDronesAndMaxForUpdate,
    incrementShipColonists,
    incrementShipCommodity,
    getShipCargoWithCredits,
} from '../db/queries/ship.js';
import { planetConfigs } from '../planet-config.js';
import { checkAndDeductTurns } from '../turn-logic.js';
import { cargoUsed } from './cargo-utils.js';

export async function serveGetSectorPlanets(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (await isInEncounter(playerId)) {
        sendError(playerId, 'Resolve drone encounter first');
        return;
    }

    // auto-land on Earth - no planet selection in sector 1
    if (player.sector === 1) {
        const earthId = await getEarthId(player.universeId);
        if (earthId) {
            return serveLandOnPlanet(playerId, {
                type: ClientTag.LandOnPlanet,
                planetId: earthId,
            });
        }
    }

    const planets = await getPlanetsInSector(player.sector, player.universeId);
    await sendEnvelope(playerId, { type: ServerTag.GetSectorPlanetsResult, planets });
}

export async function serveLandOnPlanet(
    playerId: number,
    data: LandOnPlanetCommand,
): Promise<void> {
    const { planetId } = data;
    const player = players[playerId];
    if (!player) return;

    if (await isInEncounter(playerId)) {
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

    const display = await getPlanetDisplayData(playerId);
    if (!display) {
        sendError(playerId, 'Planet no longer exists');
        return;
    }
    const ctx = await getShipPlanetContext(playerId);
    await sendEnvelope(playerId, {
        type: ServerTag.LandOnPlanetResult,
        ...display,
        empty_holds: ctx.emptyHolds,
        ship_colonists: ctx.shipColonists,
        ship_drones: ctx.shipDrones,
        ship_max_drones: ctx.shipMaxDrones,
        ship_fuel: ctx.shipFuel,
        ship_organics: ctx.shipOrganics,
        ship_equipment: ctx.shipEquipment,
    });
}

async function getShipPlanetContext(playerId: number): Promise<{
    emptyHolds: number;
    shipColonists: number;
    shipDrones: number;
    shipMaxDrones: number;
    shipFuel: number;
    shipOrganics: number;
    shipEquipment: number;
}> {
    const [ship, shipColonists, drones] = await Promise.all([
        getShipCargoWithCredits(playerId),
        getShipColonists(playerId),
        getShipDronesAndMaxForUpdate(playerId),
    ]);
    const emptyHolds = ship ? Math.max(0, ship.cargo_limit - cargoUsed(ship)) : 0;
    return {
        emptyHolds,
        shipColonists: shipColonists ?? 0,
        shipDrones: drones?.drones ?? 0,
        shipMaxDrones: drones?.max_drones ?? 0,
        shipFuel: ship?.fuel ?? 0,
        shipOrganics: ship?.organics ?? 0,
        shipEquipment: ship?.equipment ?? 0,
    };
}

export async function servePlanetDisplay(playerId: number): Promise<void> {
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
    const ctx = await getShipPlanetContext(playerId);
    sendEnvelope(playerId, {
        type: ServerTag.PlanetDisplayResult,
        ...data,
        empty_holds: ctx.emptyHolds,
        ship_colonists: ctx.shipColonists,
        ship_drones: ctx.shipDrones,
        ship_max_drones: ctx.shipMaxDrones,
        ship_fuel: ctx.shipFuel,
        ship_organics: ctx.shipOrganics,
        ship_equipment: ctx.shipEquipment,
    });
}

export async function serveLeavePlanet(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const turnResult = await checkAndDeductTurns(playerId, player.universeId, 1);
    if (!turnResult.allowed) {
        sendError(playerId, 'Insufficient turns');
        return;
    }

    await setOnPlanet(playerId, null);

    await sendEnvelope(playerId, {
        type: ServerTag.LeavePlanetResult,
        turnsUsed: turnResult.turnsUsed,
    });
}

export async function serveDestroyPlanet(playerId: number): Promise<void> {
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

    const ownership = await getPlanetOwnership(onPlanetId);
    if (!ownership) {
        sendError(playerId, 'Planet not found.');
        return;
    }
    const planetName = ownership.name;

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

    await sendEnvelope(playerId, {
        type: ServerTag.DestroyPlanetResult,
        destroyed: true,
        planetId: onPlanetId,
        planetName,
    });

    // Mail+notify any prior owners (other than the destroyer themselves).
    const { notifyAndMail } = await import('../services/notify.js');
    const body = `${player.name} destroyed planet ${planetName} in sector ${ownership.sector_number}.`;
    if (ownership.owner_player_id !== null && ownership.owner_player_id !== playerId) {
        await notifyAndMail({
            recipientId: ownership.owner_player_id,
            sender: { kind: 'player', playerId, displayName: player.name },
            kind: 'planet_destroyed',
            body,
        });
    } else if (ownership.owner_clan_id !== null) {
        const { getClanMembers } = await import('../db/queries/clan.js');
        const members = await getClanMembers(ownership.owner_clan_id);
        for (const m of members) {
            if (m.id === playerId) continue;
            await notifyAndMail({
                recipientId: m.id,
                sender: { kind: 'player', playerId, displayName: player.name },
                kind: 'planet_destroyed',
                body,
            });
        }
    }

    const data = await buildSectorDisplayData(playerId);
    if (data) sendEnvelope(playerId, { type: ServerTag.SectorDisplayResult, ...data });
}

/**
 * Pre-check for the 'U' command from the sector menu. Returns the device
 * count and whether the player can terraform here
 */
export async function serveTerraformInfo(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (await isInEncounter(playerId)) {
        sendError(playerId, 'Resolve drone encounter first');
        return;
    }

    const sectorId = player.sector;
    const universeId = player.universeId;
    const sector = await getSectorByNumber(sectorId, universeId);
    const restricted = sectorId === 1 || sector?.name === 'Starbase';

    if (restricted) {
        sendEnvelope(playerId, {
            type: ServerTag.TerraformInfoResult,
            canTerraform: false,
            devices: 0,
            reason: 'restricted_sector',
        });
        return;
    }

    const devices = await getShipHardwareQuantityByName(playerId, 'terraform_device');
    if (devices < 1) {
        sendEnvelope(playerId, {
            type: ServerTag.TerraformInfoResult,
            canTerraform: false,
            devices: 0,
            reason: 'no_devices',
        });
        return;
    }

    sendEnvelope(playerId, {
        type: ServerTag.TerraformInfoResult,
        canTerraform: true,
        devices,
    });
}

export async function serveUseTerraformDevice(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const sectorId = player.sector;
    const universeId = player.universeId;

    if (await isInEncounter(playerId)) {
        sendError(playerId, 'Resolve drone encounter first');
        return;
    }

    const sector = await getSectorByNumber(sectorId, universeId);
    const sectorName = sector?.name;
    const sectorDbId = sector?.id;

    if (sectorId === 1 || sectorName === 'Starbase') {
        sendEnvelope(playerId, {
            type: ServerTag.UseTerraformDeviceResult,
            success: false,
            reason: 'restricted_sector',
        });
        return;
    }

    const terraformQty = await getShipHardwareQuantityByName(playerId, 'terraform_device');
    if (terraformQty < 1) {
        sendEnvelope(playerId, {
            type: ServerTag.UseTerraformDeviceResult,
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
            const randomDisplayType = planetConfigs[randomType]?.displayName ?? null;

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

            return { newPlanetId, randomName, randomType, randomDisplayType, collision };
        });

        if (!result) return;

        sendEnvelope(playerId, {
            type: ServerTag.UseTerraformDeviceResult,
            success: true,
            planet: {
                id: result.newPlanetId,
                name: result.randomName,
                type: result.randomType,
                displayType: result.randomDisplayType,
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

/** Validate a colonist commodity argument. Sends an error envelope and
 * returns null on bad input; returns the typed value on success. */
function parseColonistCommodity(playerId: number, commodity: string): ColonistCommodity | null {
    if (
        commodity !== 'fuel' &&
        commodity !== 'organics' &&
        commodity !== 'equipment' &&
        commodity !== 'drones'
    ) {
        sendError(playerId, 'Invalid commodity');
        return null;
    }
    return commodity as ColonistCommodity;
}

/** Validate a planet-commodity argument (fuel/organics/equipment/drones).
 *  Same shape as parseColonistCommodity; the typed alias keeps the planet
 *  stockpile flow distinct from the colonist flow. */
function parsePlanetCommodity(playerId: number, commodity: string): PlanetCommodity | null {
    if (
        commodity !== 'fuel' &&
        commodity !== 'organics' &&
        commodity !== 'equipment' &&
        commodity !== 'drones'
    ) {
        sendError(playerId, 'Invalid commodity');
        return null;
    }
    return commodity as PlanetCommodity;
}

/** Lift the player off the planet and deliver the result + sector display
 * in one envelope. `result` carries the message-specific fields (quantity,
 * commodity, totals); the sector data is merged in. Use whenever a planet
 * action ends with the player back in the sector. */
async function liftoffWithResult<T extends { type: (typeof ServerTag)[keyof typeof ServerTag] }>(
    playerId: number,
    result: T,
): Promise<void> {
    await setOnPlanet(playerId, null);
    const sectorData = await buildSectorDisplayData(playerId);
    if (!sectorData) return;

    await sendEnvelope(playerId, { ...result, ...sectorData } as Parameters<
        typeof sendEnvelope
    >[1]);
}

export async function serveTakeColonists(
    playerId: number,
    data: TakeColonistsCommand,
): Promise<void> {
    const { quantity, commodity } = data;
    const player = players[playerId];
    if (!player) return;

    const col = parseColonistCommodity(playerId, commodity);
    if (!col) return;

    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        sendError(playerId, 'Not on a planet');
        return;
    }

    const onEarth = player.sector === 1;

    let toTake: number | undefined;
    try {
        toTake = await withTransaction(async (client) => {
            await settlePlanetProduction(onPlanetId, client);
            await settlePlanetColonistGrowth(onPlanetId, client);

            const available = await getPlanetColonistsForUpdate(onPlanetId, col, client);
            if (available === undefined) {
                sendError(playerId, 'Planet not found');
                throw new AbortTransaction();
            }

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
    } catch (err) {
        console.error('Take colonists error', err);
        sendError(playerId, 'Failed to take colonists');
    }

    if (toTake === undefined) return;

    const planetRemaining = await getPlanetColonistsRemaining(onPlanetId, col);
    const shipColonists = await getShipColonists(playerId);
    const result = {
        type: ServerTag.TakeColonistsResult,
        quantity: toTake,
        commodity: col,
        planetColonists: planetRemaining ?? 0,
        shipColonists: shipColonists ?? 0,
    };

    if (onEarth) {
        await liftoffWithResult(playerId, result);
        return;
    }
    sendEnvelope(playerId, result);
}

export async function serveLeaveColonists(
    playerId: number,
    data: LeaveColonistsCommand,
): Promise<void> {
    const { quantity, commodity } = data;
    const player = players[playerId];
    if (!player) return;

    const col = parseColonistCommodity(playerId, commodity);
    if (!col) return;

    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        sendError(playerId, 'Not on a planet');
        return;
    }
    const onEarth = player.sector === 1;

    let actual: number | undefined;
    try {
        actual = await withTransaction(async (client) => {
            await settlePlanetProduction(onPlanetId, client);
            await settlePlanetColonistGrowth(onPlanetId, client);

            const shipColonists = await getShipColonistsForUpdate(playerId, client);
            if (shipColonists === undefined || shipColonists <= 0) {
                sendError(playerId, 'No colonists on ship');
                throw new AbortTransaction();
            }

            const capacity = await getPlanetColonistsCapacity(onPlanetId, col, client);
            if (!capacity) {
                sendError(playerId, 'Planet not found');
                throw new AbortTransaction();
            }
            const room = Math.max(0, capacity.max - capacity.current);
            if (room <= 0) {
                sendError(playerId, `Planet is at max ${col} colonists`);
                throw new AbortTransaction();
            }

            const requested = quantity === -1 ? shipColonists : quantity;
            const leave = Math.min(requested, shipColonists, room);

            await incrementShipColonists(playerId, -leave, client);
            await updatePlanetColonists(onPlanetId, col, leave, client);
            return leave;
        });
    } catch (err) {
        console.error('Leave colonists error', err);
        sendError(playerId, 'Failed to leave colonists');
    }

    if (actual === undefined) return;

    const planetRemaining = await getPlanetColonistsRemaining(onPlanetId, col);
    const shipColonistsNow = await getShipColonists(playerId);
    const result = {
        type: ServerTag.LeaveColonistsResult,
        quantity: actual,
        commodity: col,
        planetColonists: planetRemaining ?? 0,
        shipColonists: shipColonistsNow ?? 0,
    };

    if (onEarth) {
        await liftoffWithResult(playerId, result);
        return;
    }
    sendEnvelope(playerId, result);
}

export async function serveTakeCommodity(
    playerId: number,
    data: TakeCommodityCommand,
): Promise<void> {
    const { quantity, commodity } = data;
    const player = players[playerId];
    if (!player) return;

    const col = parsePlanetCommodity(playerId, commodity);
    if (!col) return;

    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        sendError(playerId, 'Not on a planet');
        return;
    }

    let toTake: number | undefined;
    try {
        toTake = await withTransaction(async (client) => {
            const available = await getPlanetCommodityForUpdate(onPlanetId, col, client);
            if (available === undefined) {
                sendError(playerId, 'Planet not found');
                throw new AbortTransaction();
            }
            const requested = quantity === -1 ? available : quantity;
            const actual = Math.min(requested, available);
            if (actual <= 0) {
                sendError(playerId, `No ${col} available to take`);
                throw new AbortTransaction();
            }

            let take: number;
            if (col === 'drones') {
                const droneState = await getShipDronesAndMaxForUpdate(playerId, client);
                if (!droneState) {
                    sendError(playerId, 'No ship');
                    throw new AbortTransaction();
                }
                const room = Math.max(0, droneState.max_drones - droneState.drones);
                take = Math.min(actual, room);
                if (take <= 0) {
                    sendError(playerId, 'Ship drones at max capacity');
                    throw new AbortTransaction();
                }
            } else {
                const ship = await getShipHoldsAndCargoForUpdate(playerId, client);
                if (!ship) {
                    sendError(playerId, 'No ship');
                    throw new AbortTransaction();
                }
                const used = cargoUsed(ship);
                const free = ship.holds - used;
                take = Math.min(actual, free);
                if (take <= 0) {
                    sendError(playerId, 'No free holds');
                    throw new AbortTransaction();
                }
            }

            await updatePlanetCommodity(onPlanetId, col, -take, client);
            await incrementShipCommodity(playerId, col, take, client);
            return take;
        });
    } catch (err) {
        console.error('Take commodity error', err);
        sendError(playerId, 'Failed to take commodity');
    }

    if (toTake === undefined) return;

    const planetRemaining = await getPlanetCommodityRemaining(onPlanetId, col);
    const shipCommodity = await readShipCommodity(playerId, col);

    sendEnvelope(playerId, {
        type: ServerTag.TakeCommodityResult,
        quantity: toTake,
        commodity: col,
        planetCommodity: planetRemaining ?? 0,
        shipCommodity,
    });
}

export async function serveLeaveCommodity(
    playerId: number,
    data: LeaveCommodityCommand,
): Promise<void> {
    const { quantity, commodity } = data;
    const player = players[playerId];
    if (!player) return;

    const col = parsePlanetCommodity(playerId, commodity);
    if (!col) return;

    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        sendError(playerId, 'Not on a planet');
        return;
    }

    let actual: number | undefined;
    try {
        actual = await withTransaction(async (client) => {
            let onShip: number;
            if (col === 'drones') {
                const droneState = await getShipDronesAndMaxForUpdate(playerId, client);
                if (!droneState) {
                    sendError(playerId, 'No ship');
                    throw new AbortTransaction();
                }
                onShip = droneState.drones;
            } else {
                const ship = await getShipHoldsAndCargoForUpdate(playerId, client);
                if (!ship) {
                    sendError(playerId, 'No ship');
                    throw new AbortTransaction();
                }
                onShip =
                    col === 'fuel'
                        ? ship.fuel
                        : col === 'organics'
                          ? ship.organics
                          : ship.equipment;
            }
            if (onShip <= 0) {
                sendError(playerId, `No ${col} on ship`);
                throw new AbortTransaction();
            }

            const capacity = await getPlanetCommodityCapacity(onPlanetId, col, client);
            if (!capacity) {
                sendError(playerId, 'Planet not found');
                throw new AbortTransaction();
            }
            const room = Math.max(0, capacity.max - capacity.current);
            if (room <= 0) {
                sendError(playerId, `Planet is at max ${col}`);
                throw new AbortTransaction();
            }
            const requested = quantity === -1 ? onShip : quantity;
            const leave = Math.min(requested, onShip, room);

            await incrementShipCommodity(playerId, col, -leave, client);
            await updatePlanetCommodity(onPlanetId, col, leave, client);
            return leave;
        });
    } catch (err) {
        console.error('Leave commodity error', err);
        sendError(playerId, 'Failed to leave commodity');
    }

    if (actual === undefined) return;

    const planetRemaining = await getPlanetCommodityRemaining(onPlanetId, col);
    const shipCommodity = await readShipCommodity(playerId, col);

    sendEnvelope(playerId, {
        type: ServerTag.LeaveCommodityResult,
        quantity: actual,
        commodity: col,
        planetCommodity: planetRemaining ?? 0,
        shipCommodity,
    });
}

/** Read the current ship-side count for a take/leave-commodity response.
 *  `drones` reads from ship.drones (not cargo holds), so it needs a
 *  separate query path than the cargo-bucket commodities. */
async function readShipCommodity(playerId: number, col: PlanetCommodity): Promise<number> {
    if (col === 'drones') {
        const droneState = await getShipDronesAndMaxForUpdate(playerId);
        return droneState?.drones ?? 0;
    }
    const ship = await getShipCargoWithCredits(playerId);
    if (!ship) return 0;
    return col === 'fuel' ? ship.fuel : col === 'organics' ? ship.organics : ship.equipment;
}

/** O (Claim Planet): take ownership of the planet the player is currently
 *  on (works on enemy planets too). `ownership='clan'` is only valid if
 *  the player is in a clan. */
export async function serveClaimPlanet(playerId: number, data: ClaimPlanetCommand): Promise<void> {
    const { ownership } = data;
    const player = players[playerId];
    if (!player) return;

    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        sendError(playerId, 'Not on a planet.');
        return;
    }

    const playerClanId = await getPlayerClanId(playerId);
    if (ownership === 'clan' && playerClanId === null) {
        sendError(playerId, 'You are not in a clan.');
        return;
    }

    // Capture prior ownership BEFORE updating, so we can notify the displaced
    // owner that someone else just claimed their planet.
    const prior = await getPlanetOwnership(onPlanetId);

    if (ownership === 'clan') {
        await setPlanetOwnership(onPlanetId, null, playerClanId);
    } else {
        await setPlanetOwnership(onPlanetId, playerId, null);
    }

    const planetName = prior?.name ?? (await getPlanetName(onPlanetId)) ?? 'Planet';
    sendEnvelope(playerId, {
        type: ServerTag.ClaimPlanetResult,
        planetId: onPlanetId,
        planetName,
        ownership,
    });

    if (prior) {
        const { notifyAndMail } = await import('../services/notify.js');
        const body = `${player.name} claimed planet ${planetName} in sector ${prior.sector_number}.`;
        if (prior.owner_player_id !== null && prior.owner_player_id !== playerId) {
            await notifyAndMail({
                recipientId: prior.owner_player_id,
                sender: { kind: 'player', playerId, displayName: player.name },
                kind: 'planet_claimed',
                body,
            });
        } else if (prior.owner_clan_id !== null && prior.owner_clan_id !== playerClanId) {
            const { getClanMembers } = await import('../db/queries/clan.js');
            const members = await getClanMembers(prior.owner_clan_id);
            for (const m of members) {
                if (m.id === playerId) continue;
                await notifyAndMail({
                    recipientId: m.id,
                    sender: { kind: 'player', playerId, displayName: player.name },
                    kind: 'planet_claimed',
                    body,
                });
            }
        }
    }
}

export async function serveListPlanets(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const rows = await listPlayerPlanets(playerId, player.universeId);

    sendEnvelope(playerId, {
        type: ServerTag.ListPlanetsResult,
        planets: rows.map((r) => ({
            id: r.id,
            sectorNumber: r.sector_number,
            name: r.name,
            type: r.type,
            displayType: r.display_type,
            drones: r.drones,
            fuel: r.fuel,
            organics: r.organics,
            equipment: r.equipment,
            colonists_fuel: r.colonists_fuel,
            colonists_organics: r.colonists_organics,
            colonists_equipment: r.colonists_equipment,
            colonists_drones: r.colonists_drones,
        })),
    });
}

import { ServerTag, ClientTag, type GameEventOwnedRef } from '@twnr/shared';
import type { CommandRequest } from '@twnr/shared';
import { onlinePlayers } from '../state/players.js';
import { sendEnvelope } from '../state/messaging.js';
import { buildSectorDisplayData } from '../services/sector-display.js';
import { broadcastSectorActivity } from '../services/sector-activity.js';
import { isInEncounter } from '../services/encounter.js';

import {
    getEarthId,
    getPlanetInSector,
    getPlanetDisplayData,
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
    setPlanetName,
    getPlanetOwnerPlayerId,
    type ColonistCommodity,
    type PlanetCommodity,
} from '../db/queries/planet.js';
import { getPlayerClanId, getClanById } from '../db/queries/clan.js';
import { getPlanetsInSector } from '../db/queries/sector.js';
import {
    adjustReputationAndExperience,
    getOnPlanetId,
    getPlayerReputationForUpdate,
    setDocked,
    setOnPlanet,
    listPlayersOnPlanet,
} from '../db/queries/player.js';
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
import { reputationDeltas, experienceDeltas, scalarDelta } from '../game-config.js';
import { checkAndDeductTurns } from '../turn-logic.js';
import { cargoUsed } from './cargo-utils.js';
import { notifyTurnChange } from '../services/notify.js';
import { recordGameEvent } from '../services/game-events.js';
import { notifyPlanetDestroyed } from '../services/planet-destruction.js';
import {
    type CommandError,
    type CommandResult,
    commandError,
    abort,
    isCommandError,
    runMutation,
} from './command.js';

export async function serveGetSectorPlanets(
    playerId: number,
): Promise<CommandResult<'GetSectorPlanets'>> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    if (await isInEncounter(playerId)) {
        return commandError('Resolve drone encounter first');
    }

    if (player.sector === 1) {
        const earthId = await getEarthId(player.universeId);
        if (earthId) {
            // Earth is the only planet here: land directly. The client's land routine accepts either reply.
            const landed = await serveLandOnPlanet(playerId, {
                type: ClientTag.LandOnPlanet,
                planetId: earthId,
            });
            if (isCommandError(landed)) return landed;
            if (landed) sendEnvelope(playerId, { type: ServerTag.LandOnPlanetResult, ...landed });
            return;
        }
    }

    const planets = await getPlanetsInSector(player.sector, player.universeId);
    return { planets };
}

export async function serveLandOnPlanet(
    playerId: number,
    data: CommandRequest<'LandOnPlanet'>,
): Promise<CommandResult<'LandOnPlanet'>> {
    const { planetId } = data;
    const player = onlinePlayers[playerId];
    if (!player) return;

    if (await isInEncounter(playerId)) {
        return commandError('Resolve drone encounter first');
    }

    const planet = await getPlanetInSector(planetId, player.sector, player.universeId);
    if (!planet) {
        return commandError('Planet not found in this sector');
    }

    if (player.docked) {
        player.docked = false;
        await setDocked(playerId, false);
    }

    await setOnPlanet(playerId, planetId);
    void broadcastSectorActivity(playerId, 'land', planet.name);

    const display = await getPlanetDisplayData(playerId);
    if (!display) {
        return commandError('Planet no longer exists');
    }
    const ctx = await getShipPlanetContext(playerId);
    return {
        ...display,
        empty_holds: ctx.emptyHolds,
        ship_colonists: ctx.shipColonists,
        ship_drones: ctx.shipDrones,
        ship_max_drones: ctx.shipMaxDrones,
        ship_fuel: ctx.shipFuel,
        ship_organics: ctx.shipOrganics,
        ship_equipment: ctx.shipEquipment,
    };
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

export async function servePlanetDisplay(
    playerId: number,
): Promise<CommandResult<'PlanetDisplay'>> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        return commandError('Not on a planet');
    }

    const data = await getPlanetDisplayData(playerId);
    if (!data) {
        return commandError('Planet no longer exists');
    }
    const ctx = await getShipPlanetContext(playerId);
    return {
        ...data,
        empty_holds: ctx.emptyHolds,
        ship_colonists: ctx.shipColonists,
        ship_drones: ctx.shipDrones,
        ship_max_drones: ctx.shipMaxDrones,
        ship_fuel: ctx.shipFuel,
        ship_organics: ctx.shipOrganics,
        ship_equipment: ctx.shipEquipment,
    };
}

export async function serveLeavePlanet(playerId: number): Promise<CommandResult<'LeavePlanet'>> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    const turnResult = await checkAndDeductTurns(playerId, player.universeId, 1);
    if (!turnResult.allowed) {
        return commandError('Insufficient turns');
    }
    if (turnResult.turnsUsed) {
        notifyTurnChange(playerId, turnResult.turnsUsed, 'leaving planet');
    }

    const leavingPlanetId = await getOnPlanetId(playerId);
    const leavingPlanetName =
        leavingPlanetId !== null
            ? ((await getPlanetOwnership(leavingPlanetId))?.name ?? null)
            : null;

    await setOnPlanet(playerId, null);
    if (leavingPlanetId !== null) {
        void broadcastSectorActivity(playerId, 'liftoff', leavingPlanetName);
    }

    return {
        turnsUsed: turnResult.turnsUsed,
    };
}

export async function serveDestroyPlanet(
    playerId: number,
): Promise<CommandResult<'DestroyPlanet'>> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        return commandError('Not on a planet');
    }

    const busters = await getShipHardwareQuantityByName(playerId, 'planet_buster');
    if (busters < 1) {
        return commandError('You do not have a planet buster.');
    }

    const ownership = await getPlanetOwnership(onPlanetId);
    if (!ownership) {
        return commandError('Planet not found.');
    }
    const planetName = ownership.name;

    const destroyRep = scalarDelta(reputationDeltas, 'destroyPlanet');
    const destroyExp = scalarDelta(experienceDeltas, 'destroyPlanet');
    return runMutation(
        'Destroy planet',
        async (client) => {
            const occupants = await listPlayersOnPlanet(onPlanetId, client);
            await decrementShipHardwareByName(playerId, 'planet_buster', client);
            await setOnPlanet(playerId, null, client);
            await deletePlanet(onPlanetId, client);
            await adjustReputationAndExperience(playerId, destroyRep, destroyExp, client);
            await recordGameEvent(
                player.universeId,
                {
                    kind: 'planet_destroyed',
                    destroyer: { playerId, name: player.name },
                    planet: { planetId: onPlanetId, name: planetName },
                    sectorNumber: ownership.sector_number,
                },
                client,
            );
            return occupants.map((occupant) => occupant.id);
        },
        async (occupantIds) => {
            await notifyPlanetDestroyed({
                universeId: player.universeId,
                sectorNumber: ownership.sector_number,
                planetName,
                cause: 'buster',
                occupantIds,
                occupantMailBody:
                    `${player.name} destroyed planet ${planetName} in sector ${ownership.sector_number} ` +
                    `while you were on the surface. You escaped to your ship.`,
                sender: { kind: 'player', playerId, displayName: player.name },
                excludePlayerId: playerId,
            });

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

            const sectorData = await buildSectorDisplayData(playerId);
            if (!sectorData) return undefined;
            return {
                ...sectorData,
                destroyed: true,
                planetId: onPlanetId,
                planetName,
                expDelta: destroyExp,
                repDelta: destroyRep,
            };
        },
        'Failed to destroy planet.',
    );
}

export async function serveTerraformInfo(
    playerId: number,
): Promise<CommandResult<'TerraformInfo'>> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    if (await isInEncounter(playerId)) {
        return commandError('Resolve drone encounter first');
    }

    const sectorId = player.sector;
    const universeId = player.universeId;
    const sector = await getSectorByNumber(sectorId, universeId);
    const restricted = sectorId === 1 || sector?.name === 'Starbase';

    if (restricted) {
        return {
            canTerraform: false,
            devices: 0,
            reason: 'restricted_sector',
        };
    }

    const devices = await getShipHardwareQuantityByName(playerId, 'terraform_device');
    if (devices < 1) {
        return {
            canTerraform: false,
            devices: 0,
            reason: 'no_devices',
        };
    }

    return {
        canTerraform: true,
        devices,
    };
}

export async function serveUseTerraformDevice(
    playerId: number,
): Promise<CommandResult<'UseTerraformDevice'>> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    const sectorId = player.sector;
    const universeId = player.universeId;

    if (await isInEncounter(playerId)) {
        return commandError('Resolve drone encounter first');
    }

    const sector = await getSectorByNumber(sectorId, universeId);
    const sectorName = sector?.name;
    const sectorDbId = sector?.id;

    if (sectorId === 1 || sectorName === 'Starbase') {
        return {
            success: false,
            reason: 'restricted_sector',
        };
    }

    const terraformQty = await getShipHardwareQuantityByName(playerId, 'terraform_device');
    if (terraformQty < 1) {
        return {
            success: false,
            reason: 'no_devices',
            terraformDevices: 0,
        };
    }

    if (!sectorDbId) {
        return commandError('Sector not found');
    }

    return runMutation(
        'Use terraform device',
        async (client) => {
            const universeInfo = await getTerraformConfigForUniverse(universeId, client);
            if (!universeInfo) {
                throw abort(commandError('Universe not found'));
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

            const currentRep = await getPlayerReputationForUpdate(playerId, client);
            const bucket =
                currentRep > 0
                    ? 'blueCreatesPlanet'
                    : currentRep < 0
                      ? 'redCreatesPlanet'
                      : 'neutralCreatesPlanet';
            const repDelta = scalarDelta(reputationDeltas, bucket);
            const expDelta = scalarDelta(experienceDeltas, bucket);
            await adjustReputationAndExperience(playerId, repDelta, expDelta, client);

            return {
                newPlanetId,
                randomName,
                randomType,
                randomDisplayType,
                collision,
                repDelta,
                expDelta,
            };
        },
        (result) => ({
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
            expDelta: result.expDelta,
            repDelta: result.repDelta,
        }),
        'Failed to use terraform device.',
    );
}

export async function serveSetTerraformedPlanet(
    playerId: number,
    data: CommandRequest<'SetTerraformedPlanet'>,
): Promise<CommandResult<'SetTerraformedPlanet'>> {
    const { planetId, name, ownership } = data;
    const trimmedName = name.trim();
    if (trimmedName.length === 0 || trimmedName.length > 64) {
        return {
            outcome: 'error',
            message: 'Name must be 1-64 characters.',
        };
    }
    const owner = await getPlanetOwnerPlayerId(planetId);
    if (owner === undefined) {
        return {
            outcome: 'error',
            message: 'Planet not found.',
        };
    }
    if (owner !== playerId) {
        return {
            outcome: 'error',
            message: 'You do not own that planet.',
        };
    }
    const clanId = ownership === 'clan' ? await getPlayerClanId(playerId) : null;
    if (ownership === 'clan' && clanId === null) {
        return {
            outcome: 'error',
            message: 'You are not in a clan.',
        };
    }
    await setPlanetName(planetId, trimmedName);
    if (ownership === 'clan') {
        await setPlanetOwnership(planetId, null, clanId);
    }
    return {
        outcome: 'success',
        planetId,
        name: trimmedName,
        ownership,
    };
}

function parseColonistCommodity(commodity: string): ColonistCommodity | CommandError {
    if (commodity !== 'fuel' && commodity !== 'organics' && commodity !== 'equipment') {
        return commandError('Invalid commodity');
    }
    return commodity as ColonistCommodity;
}

function parsePlanetCommodity(commodity: string): PlanetCommodity | CommandError {
    if (
        commodity !== 'fuel' &&
        commodity !== 'organics' &&
        commodity !== 'equipment' &&
        commodity !== 'drones'
    ) {
        return commandError('Invalid commodity');
    }
    return commodity as PlanetCommodity;
}

/** Lifts the player off Earth; the returned sector display is merged into the colonist reply. */
async function liftoffSectorData(playerId: number) {
    const leavingPlanetId = await getOnPlanetId(playerId);
    const leavingPlanetName =
        leavingPlanetId !== null
            ? ((await getPlanetOwnership(leavingPlanetId))?.name ?? null)
            : null;
    await setOnPlanet(playerId, null);
    if (leavingPlanetId !== null) {
        void broadcastSectorActivity(playerId, 'liftoff', leavingPlanetName);
    }
    return buildSectorDisplayData(playerId);
}

export async function serveTakeColonists(
    playerId: number,
    data: CommandRequest<'TakeColonists'>,
): Promise<CommandResult<'TakeColonists'>> {
    const { quantity, commodity } = data;
    const player = onlinePlayers[playerId];
    if (!player) return;

    const col = parseColonistCommodity(commodity);
    if (isCommandError(col)) return col;

    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        return commandError('Not on a planet');
    }

    const onEarth = player.sector === 1;

    return runMutation(
        'Take colonists',
        async (client) => {
            await settlePlanetProduction(onPlanetId, client);
            await settlePlanetColonistGrowth(onPlanetId, client);

            const available = await getPlanetColonistsForUpdate(onPlanetId, col, client);
            if (available === undefined) {
                throw abort(commandError('Planet not found'));
            }

            const requested = quantity === -1 ? available : quantity;
            const actual = Math.min(requested, available);
            if (actual <= 0) {
                throw abort(commandError('No colonists available to take'));
            }

            const ship = await getShipHoldsAndCargoForUpdate(playerId, client);
            if (!ship) {
                throw abort(commandError('No ship'));
            }
            const used = cargoUsed(ship);
            const free = ship.holds - used;
            const take = Math.min(actual, free);
            if (take <= 0) {
                throw abort(commandError('No free holds'));
            }

            await updatePlanetColonists(onPlanetId, col, -take, client);
            await incrementShipColonists(playerId, take, client);
            return take;
        },
        async (toTake) => {
            const planetRemaining = await getPlanetColonistsRemaining(onPlanetId, col);
            const shipColonists = await getShipColonists(playerId);
            const result = {
                quantity: toTake,
                commodity: col,
                planetColonists: planetRemaining ?? 0,
                shipColonists: shipColonists ?? 0,
            };

            if (onEarth) {
                const sectorData = await liftoffSectorData(playerId);
                return sectorData ? { ...result, ...sectorData } : result;
            }
            return result;
        },
        'Failed to take colonists',
    );
}

export async function serveLeaveColonists(
    playerId: number,
    data: CommandRequest<'LeaveColonists'>,
): Promise<CommandResult<'LeaveColonists'>> {
    const { quantity, commodity } = data;
    const player = onlinePlayers[playerId];
    if (!player) return;

    const col = parseColonistCommodity(commodity);
    if (isCommandError(col)) return col;

    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        return commandError('Not on a planet');
    }
    const onEarth = player.sector === 1;

    return runMutation(
        'Leave colonists',
        async (client) => {
            await settlePlanetProduction(onPlanetId, client);
            await settlePlanetColonistGrowth(onPlanetId, client);

            const shipColonists = await getShipColonistsForUpdate(playerId, client);
            if (shipColonists === undefined || shipColonists <= 0) {
                throw abort(commandError('No colonists on ship'));
            }

            const capacity = await getPlanetColonistsCapacity(onPlanetId, col, client);
            if (!capacity) {
                throw abort(commandError('Planet not found'));
            }
            const room = Math.max(0, capacity.max - capacity.current);
            if (room <= 0) {
                throw abort(commandError(`Planet is at max ${col} colonists`));
            }

            const requested = quantity === -1 ? shipColonists : quantity;
            const leave = Math.min(requested, shipColonists, room);

            await incrementShipColonists(playerId, -leave, client);
            await updatePlanetColonists(onPlanetId, col, leave, client);
            return leave;
        },
        async (actual) => {
            const planetRemaining = await getPlanetColonistsRemaining(onPlanetId, col);
            const shipColonistsNow = await getShipColonists(playerId);
            const result = {
                quantity: actual,
                commodity: col,
                planetColonists: planetRemaining ?? 0,
                shipColonists: shipColonistsNow ?? 0,
            };

            if (onEarth) {
                const sectorData = await liftoffSectorData(playerId);
                return sectorData ? { ...result, ...sectorData } : result;
            }
            return result;
        },
        'Failed to leave colonists',
    );
}

export async function serveTakeCommodity(
    playerId: number,
    data: CommandRequest<'TakeCommodity'>,
): Promise<CommandResult<'TakeCommodity'>> {
    const { quantity, commodity } = data;
    const player = onlinePlayers[playerId];
    if (!player) return;

    const col = parsePlanetCommodity(commodity);
    if (isCommandError(col)) return col;

    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        return commandError('Not on a planet');
    }

    return runMutation(
        'Take commodity',
        async (client) => {
            const available = await getPlanetCommodityForUpdate(onPlanetId, col, client);
            if (available === undefined) {
                throw abort(commandError('Planet not found'));
            }
            const requested = quantity === -1 ? available : quantity;
            const actual = Math.min(requested, available);
            if (actual <= 0) {
                throw abort(commandError(`No ${col} available to take`));
            }

            let take: number;
            if (col === 'drones') {
                const droneState = await getShipDronesAndMaxForUpdate(playerId, client);
                if (!droneState) {
                    throw abort(commandError('No ship'));
                }
                const room = Math.max(0, droneState.max_drones - droneState.drones);
                take = Math.min(actual, room);
                if (take <= 0) {
                    throw abort(commandError('Ship drones at max capacity'));
                }
            } else {
                const ship = await getShipHoldsAndCargoForUpdate(playerId, client);
                if (!ship) {
                    throw abort(commandError('No ship'));
                }
                const used = cargoUsed(ship);
                const free = ship.holds - used;
                take = Math.min(actual, free);
                if (take <= 0) {
                    throw abort(commandError('No free holds'));
                }
            }

            await updatePlanetCommodity(onPlanetId, col, -take, client);
            await incrementShipCommodity(playerId, col, take, client);
            return take;
        },
        async (toTake) => {
            const planetRemaining = await getPlanetCommodityRemaining(onPlanetId, col);
            const shipCommodity = await readShipCommodity(playerId, col);

            return {
                quantity: toTake,
                commodity: col,
                planetCommodity: planetRemaining ?? 0,
                shipCommodity,
            };
        },
        'Failed to take commodity',
    );
}

export async function serveLeaveCommodity(
    playerId: number,
    data: CommandRequest<'LeaveCommodity'>,
): Promise<CommandResult<'LeaveCommodity'>> {
    const { quantity, commodity } = data;
    const player = onlinePlayers[playerId];
    if (!player) return;

    const col = parsePlanetCommodity(commodity);
    if (isCommandError(col)) return col;

    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        return commandError('Not on a planet');
    }

    return runMutation(
        'Leave commodity',
        async (client) => {
            let onShip: number;
            if (col === 'drones') {
                const droneState = await getShipDronesAndMaxForUpdate(playerId, client);
                if (!droneState) {
                    throw abort(commandError('No ship'));
                }
                onShip = droneState.drones;
            } else {
                const ship = await getShipHoldsAndCargoForUpdate(playerId, client);
                if (!ship) {
                    throw abort(commandError('No ship'));
                }
                onShip =
                    col === 'fuel'
                        ? ship.fuel
                        : col === 'organics'
                          ? ship.organics
                          : ship.equipment;
            }
            if (onShip <= 0) {
                throw abort(commandError(`No ${col} on ship`));
            }

            const capacity = await getPlanetCommodityCapacity(onPlanetId, col, client);
            if (!capacity) {
                throw abort(commandError('Planet not found'));
            }
            const room = Math.max(0, capacity.max - capacity.current);
            if (room <= 0) {
                throw abort(commandError(`Planet is at max ${col}`));
            }
            const requested = quantity === -1 ? onShip : quantity;
            const leave = Math.min(requested, onShip, room);

            await incrementShipCommodity(playerId, col, -leave, client);
            await updatePlanetCommodity(onPlanetId, col, leave, client);
            return leave;
        },
        async (actual) => {
            const planetRemaining = await getPlanetCommodityRemaining(onPlanetId, col);
            const shipCommodity = await readShipCommodity(playerId, col);

            return {
                quantity: actual,
                commodity: col,
                planetCommodity: planetRemaining ?? 0,
                shipCommodity,
            };
        },
        'Failed to leave commodity',
    );
}

export async function serveChangePopulation(
    playerId: number,
    data: CommandRequest<'ChangePopulation'>,
): Promise<CommandResult<'ChangePopulation'>> {
    const { quantity, from, to } = data;
    const player = onlinePlayers[playerId];
    if (!player) return;

    if (from !== 'fuel' && from !== 'organics' && from !== 'equipment') {
        return commandError('Invalid source production group');
    }
    if (to !== 'fuel' && to !== 'organics' && to !== 'equipment') {
        return commandError('Invalid target production group');
    }
    if (from === to) {
        return commandError('Source and target groups are the same');
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
        return commandError('Invalid quantity');
    }

    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        return commandError('Not on a planet');
    }

    return runMutation(
        'Change population',
        async (client) => {
            await settlePlanetProduction(onPlanetId, client);
            await settlePlanetColonistGrowth(onPlanetId, client);

            const sourceAvail = await getPlanetColonistsForUpdate(onPlanetId, from, client);
            if (sourceAvail === undefined) {
                throw abort(commandError('Planet not found'));
            }
            if (sourceAvail <= 0) {
                throw abort(commandError(`No colonists in ${from} group`));
            }

            const targetCap = await getPlanetColonistsCapacity(onPlanetId, to, client);
            if (!targetCap) {
                throw abort(commandError('Planet not found'));
            }
            const room = Math.max(0, targetCap.max - targetCap.current);
            if (room <= 0) {
                throw abort(commandError(`Target ${to} group is at max`));
            }

            const actual = Math.min(quantity, sourceAvail, room);
            await updatePlanetColonists(onPlanetId, from, -actual, client);
            await updatePlanetColonists(onPlanetId, to, actual, client);
            return actual;
        },
        async (moved) => {
            const fromCount = (await getPlanetColonistsRemaining(onPlanetId, from)) ?? 0;
            const toCount = (await getPlanetColonistsRemaining(onPlanetId, to)) ?? 0;
            return {
                quantity: moved,
                from,
                to,
                fromCount,
                toCount,
            };
        },
        'Failed to change population',
    );
}

async function readShipCommodity(playerId: number, col: PlanetCommodity): Promise<number> {
    if (col === 'drones') {
        const droneState = await getShipDronesAndMaxForUpdate(playerId);
        return droneState?.drones ?? 0;
    }
    const ship = await getShipCargoWithCredits(playerId);
    if (!ship) return 0;
    return col === 'fuel' ? ship.fuel : col === 'organics' ? ship.organics : ship.equipment;
}

export async function serveClaimPlanet(
    playerId: number,
    data: CommandRequest<'ClaimPlanet'>,
): Promise<CommandResult<'ClaimPlanet'>> {
    const { ownership } = data;
    const player = onlinePlayers[playerId];
    if (!player) return;

    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        return commandError('Not on a planet.');
    }

    const playerClanId = await getPlayerClanId(playerId);
    if (ownership === 'clan' && playerClanId === null) {
        return commandError('You are not in a clan.');
    }

    const previousOwner = await getPlanetOwnership(onPlanetId);
    if (!previousOwner) {
        return commandError('Planet not found.');
    }
    const planetName = previousOwner.name;

    const claimingClan =
        playerClanId !== null && ownership === 'clan' ? await getClanById(playerClanId) : null;
    if (ownership === 'clan' && !claimingClan) {
        return commandError('Clan not found.');
    }
    const newOwner: GameEventOwnedRef = claimingClan
        ? {
              kind: 'clan',
              clanId: claimingClan.id,
              clanNumber: claimingClan.universe_clan_number,
              name: claimingClan.name,
          }
        : { kind: 'player', playerId, name: player.name };
    const ownerChanged = claimingClan
        ? previousOwner.owner_clan_id !== claimingClan.id
        : previousOwner.owner_player_id !== playerId;

    return runMutation(
        'Claim planet',
        async (client) => {
            if (claimingClan) {
                await setPlanetOwnership(onPlanetId, null, claimingClan.id, client);
            } else {
                await setPlanetOwnership(onPlanetId, playerId, null, client);
            }
            if (ownerChanged) {
                await recordGameEvent(
                    player.universeId,
                    {
                        kind: 'planet_claimed',
                        planet: { planetId: onPlanetId, name: planetName },
                        sectorNumber: previousOwner.sector_number,
                        claimedBy: { playerId, name: player.name },
                        owner: newOwner,
                    },
                    client,
                );
            }
            return true;
        },
        async () => {
            const { notifyAndMail } = await import('../services/notify.js');
            const body = `${player.name} claimed planet ${planetName} in sector ${previousOwner.sector_number}.`;
            if (
                previousOwner.owner_player_id !== null &&
                previousOwner.owner_player_id !== playerId
            ) {
                await notifyAndMail({
                    recipientId: previousOwner.owner_player_id,
                    sender: { kind: 'player', playerId, displayName: player.name },
                    kind: 'planet_claimed',
                    body,
                });
            } else if (
                previousOwner.owner_clan_id !== null &&
                previousOwner.owner_clan_id !== playerClanId
            ) {
                const { getClanMembers } = await import('../db/queries/clan.js');
                const members = await getClanMembers(previousOwner.owner_clan_id);
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
            return { planetId: onPlanetId, planetName, ownership };
        },
        'Failed to claim planet.',
    );
}

export async function serveListPlanets(playerId: number): Promise<CommandResult<'ListPlanets'>> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    const rows = await listPlayerPlanets(playerId, player.universeId);

    return {
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
        })),
    };
}

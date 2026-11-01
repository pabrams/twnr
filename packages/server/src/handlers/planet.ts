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
import { type CommandResult, commandRefusal, mutateAndReply } from './command.js';

export async function serveGetSectorPlanets(
    playerId: number,
): Promise<CommandResult<'GetSectorPlanets'>> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    if (isInEncounter(playerId)) {
        return commandRefusal('inEncounter');
    }

    if (player.sector === 1) {
        const earthId = await getEarthId(player.universeId);
        if (earthId) {
            // Earth is the only planet here: land directly. The client's land routine accepts either reply.
            const landed = await serveLandOnPlanet(playerId, {
                type: ClientTag.LandOnPlanet,
                planetId: earthId,
            });
            if (landed?.outcome === 'refused') return landed;
            if (landed) {
                sendEnvelope(playerId, {
                    type: ServerTag.LandOnPlanetResult,
                    outcome: 'ok',
                    ...landed,
                });
            }
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

    if (isInEncounter(playerId)) {
        return commandRefusal('inEncounter');
    }

    const planet = await getPlanetInSector(planetId, player.sector, player.universeId);
    if (!planet) {
        return commandRefusal('planetGone');
    }

    if (player.docked) {
        player.docked = false;
        await setDocked(playerId, false);
    }

    await setOnPlanet(playerId, planetId);
    void broadcastSectorActivity(playerId, 'land', planet.name);

    const display = await getPlanetDisplayData(playerId);
    if (!display) {
        return commandRefusal('planetGone');
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
        return commandRefusal('notOnPlanet');
    }

    const data = await getPlanetDisplayData(playerId);
    if (!data) {
        return commandRefusal('planetGone');
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
        return commandRefusal('insufficientTurns');
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
        return commandRefusal('notOnPlanet');
    }

    const busters = await getShipHardwareQuantityByName(playerId, 'planet_buster');
    if (busters < 1) {
        return commandRefusal('noPlanetBuster');
    }

    const ownership = await getPlanetOwnership(onPlanetId);
    if (!ownership) {
        return commandRefusal('planetGone');
    }
    const planetName = ownership.name;

    const destroyRep = scalarDelta(reputationDeltas, 'destroyPlanet');
    const destroyExp = scalarDelta(experienceDeltas, 'destroyPlanet');
    return mutateAndReply(
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
    );
}

export async function serveTerraformInfo(
    playerId: number,
): Promise<CommandResult<'TerraformInfo'>> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    if (isInEncounter(playerId)) {
        return commandRefusal('inEncounter');
    }

    const sectorId = player.sector;
    const universeId = player.universeId;
    const sector = await getSectorByNumber(sectorId, universeId);
    const restricted = sectorId === 1 || sector?.name === 'Starbase';

    if (restricted) return commandRefusal('restrictedSector');

    const devices = await getShipHardwareQuantityByName(playerId, 'terraform_device');
    if (devices < 1) return commandRefusal('noTerraformDevices');

    return { devices };
}

export async function serveUseTerraformDevice(
    playerId: number,
): Promise<CommandResult<'UseTerraformDevice'>> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    const sectorId = player.sector;
    const universeId = player.universeId;

    if (isInEncounter(playerId)) {
        return commandRefusal('inEncounter');
    }

    const sector = await getSectorByNumber(sectorId, universeId);
    const sectorName = sector?.name;
    const sectorDbId = sector?.id;

    if (sectorId === 1 || sectorName === 'Starbase') return commandRefusal('restrictedSector');

    const terraformQty = await getShipHardwareQuantityByName(playerId, 'terraform_device');
    if (terraformQty < 1) return commandRefusal('noTerraformDevices');

    if (!sectorDbId) {
        throw new Error('Sector not found');
    }

    return mutateAndReply(
        async (client) => {
            const universeInfo = await getTerraformConfigForUniverse(universeId, client);
            if (!universeInfo) {
                throw new Error('Universe not found');
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
    );
}

export async function serveSetTerraformedPlanet(
    playerId: number,
    data: CommandRequest<'SetTerraformedPlanet'>,
): Promise<CommandResult<'SetTerraformedPlanet'>> {
    const { planetId, name, ownership } = data;
    const trimmedName = name.trim();
    const owner = await getPlanetOwnerPlayerId(planetId);
    if (owner === undefined) {
        return commandRefusal('planetGone');
    }
    if (owner !== playerId) {
        return commandRefusal('notPlanetOwner');
    }
    const clanId = ownership === 'clan' ? await getPlayerClanId(playerId) : null;
    if (ownership === 'clan' && clanId === null) {
        return commandRefusal('notInClan');
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

    const col = commodity;

    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        return commandRefusal('notOnPlanet');
    }

    const onEarth = player.sector === 1;

    return mutateAndReply(
        async (client, abort) => {
            await settlePlanetProduction(onPlanetId, client);
            await settlePlanetColonistGrowth(onPlanetId, client);

            const available = await getPlanetColonistsForUpdate(onPlanetId, col, client);
            if (available === undefined) {
                throw abort(commandRefusal('planetGone'));
            }

            const requested = quantity === -1 ? available : quantity;
            const actual = Math.min(requested, available);
            if (actual <= 0) {
                throw abort(commandRefusal('noColonistsAvailable'));
            }

            const ship = await getShipHoldsAndCargoForUpdate(playerId, client);
            if (!ship) {
                throw abort(commandRefusal('noShip'));
            }
            const used = cargoUsed(ship);
            const free = ship.holds - used;
            const take = Math.min(actual, free);
            if (take <= 0) {
                throw abort(commandRefusal('insufficientHolds'));
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
    );
}

export async function serveLeaveColonists(
    playerId: number,
    data: CommandRequest<'LeaveColonists'>,
): Promise<CommandResult<'LeaveColonists'>> {
    const { quantity, commodity } = data;
    const player = onlinePlayers[playerId];
    if (!player) return;

    const col = commodity;

    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        return commandRefusal('notOnPlanet');
    }
    const onEarth = player.sector === 1;

    return mutateAndReply(
        async (client, abort) => {
            await settlePlanetProduction(onPlanetId, client);
            await settlePlanetColonistGrowth(onPlanetId, client);

            const shipColonists = await getShipColonistsForUpdate(playerId, client);
            if (shipColonists === undefined || shipColonists <= 0) {
                throw abort(commandRefusal('noColonistsOnShip'));
            }

            const capacity = await getPlanetColonistsCapacity(onPlanetId, col, client);
            if (!capacity) {
                throw abort(commandRefusal('planetGone'));
            }
            const room = Math.max(0, capacity.max - capacity.current);
            if (room <= 0) {
                throw abort(commandRefusal('planetAtMaxColonists', { group: col }));
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
    );
}

export async function serveTakeCommodity(
    playerId: number,
    data: CommandRequest<'TakeCommodity'>,
): Promise<CommandResult<'TakeCommodity'>> {
    const { quantity, commodity } = data;
    const player = onlinePlayers[playerId];
    if (!player) return;

    const col = commodity;

    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        return commandRefusal('notOnPlanet');
    }

    return mutateAndReply(
        async (client, abort) => {
            const available = await getPlanetCommodityForUpdate(onPlanetId, col, client);
            if (available === undefined) {
                throw abort(commandRefusal('planetGone'));
            }
            const requested = quantity === -1 ? available : quantity;
            const actual = Math.min(requested, available);
            if (actual <= 0) {
                throw abort(commandRefusal('noCommodityOnPlanet', { commodity: col }));
            }

            let take: number;
            if (col === 'drones') {
                const droneState = await getShipDronesAndMaxForUpdate(playerId, client);
                if (!droneState) {
                    throw abort(commandRefusal('noShip'));
                }
                const room = Math.max(0, droneState.max_drones - droneState.drones);
                take = Math.min(actual, room);
                if (take <= 0) {
                    throw abort(commandRefusal('shipDronesAtMax'));
                }
            } else {
                const ship = await getShipHoldsAndCargoForUpdate(playerId, client);
                if (!ship) {
                    throw abort(commandRefusal('noShip'));
                }
                const used = cargoUsed(ship);
                const free = ship.holds - used;
                take = Math.min(actual, free);
                if (take <= 0) {
                    throw abort(commandRefusal('insufficientHolds'));
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
    );
}

export async function serveLeaveCommodity(
    playerId: number,
    data: CommandRequest<'LeaveCommodity'>,
): Promise<CommandResult<'LeaveCommodity'>> {
    const { quantity, commodity } = data;
    const player = onlinePlayers[playerId];
    if (!player) return;

    const col = commodity;

    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        return commandRefusal('notOnPlanet');
    }

    return mutateAndReply(
        async (client, abort) => {
            let onShip: number;
            if (col === 'drones') {
                const droneState = await getShipDronesAndMaxForUpdate(playerId, client);
                if (!droneState) {
                    throw abort(commandRefusal('noShip'));
                }
                onShip = droneState.drones;
            } else {
                const ship = await getShipHoldsAndCargoForUpdate(playerId, client);
                if (!ship) {
                    throw abort(commandRefusal('noShip'));
                }
                onShip =
                    col === 'fuel'
                        ? ship.fuel
                        : col === 'organics'
                          ? ship.organics
                          : ship.equipment;
            }
            if (onShip <= 0) {
                throw abort(commandRefusal('insufficientCargo', { commodity: col }));
            }

            const capacity = await getPlanetCommodityCapacity(onPlanetId, col, client);
            if (!capacity) {
                throw abort(commandRefusal('planetGone'));
            }
            const room = Math.max(0, capacity.max - capacity.current);
            if (room <= 0) {
                throw abort(commandRefusal('planetAtMax', { commodity: col }));
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
    );
}

export async function serveChangePopulation(
    playerId: number,
    data: CommandRequest<'ChangePopulation'>,
): Promise<CommandResult<'ChangePopulation'>> {
    const { quantity, from, to } = data;
    const player = onlinePlayers[playerId];
    if (!player) return;
    if (from === to) {
        return commandRefusal('sameGroup');
    }

    const onPlanetId = await getOnPlanetId(playerId);
    if (!onPlanetId) {
        return commandRefusal('notOnPlanet');
    }

    return mutateAndReply(
        async (client, abort) => {
            await settlePlanetProduction(onPlanetId, client);
            await settlePlanetColonistGrowth(onPlanetId, client);

            const sourceAvail = await getPlanetColonistsForUpdate(onPlanetId, from, client);
            if (sourceAvail === undefined) {
                throw abort(commandRefusal('planetGone'));
            }
            if (sourceAvail <= 0) {
                throw abort(commandRefusal('noColonistsInGroup', { group: from }));
            }

            const targetCap = await getPlanetColonistsCapacity(onPlanetId, to, client);
            if (!targetCap) {
                throw abort(commandRefusal('planetGone'));
            }
            const room = Math.max(0, targetCap.max - targetCap.current);
            if (room <= 0) {
                throw abort(commandRefusal('groupAtMax', { group: to }));
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
        return commandRefusal('notOnPlanet');
    }

    const playerClanId = await getPlayerClanId(playerId);
    if (ownership === 'clan' && playerClanId === null) {
        return commandRefusal('notInClan');
    }

    const previousOwner = await getPlanetOwnership(onPlanetId);
    if (!previousOwner) {
        return commandRefusal('planetGone');
    }
    const planetName = previousOwner.name;

    const claimingClan =
        playerClanId !== null && ownership === 'clan' ? await getClanById(playerClanId) : null;
    if (ownership === 'clan' && !claimingClan) {
        return commandRefusal('clanNotFound');
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

    return mutateAndReply(
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

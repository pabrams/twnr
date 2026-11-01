import type { CommandRequest } from '@twnr/shared';
import { onlinePlayers } from '../state/players.js';

import {
    getHardwareItemByName,
    getShipHardwareCapacityForUpdate,
    decrementShipHardwareQuantity,
} from '../db/queries/hardware.js';
import {
    getSectorBeaconForUpdate,
    insertSectorBeacon,
    deleteSectorBeacon,
} from '../db/queries/beacons.js';
import { getShipDronesForUpdate, setShipDrones } from '../db/queries/ship.js';
import { isInEncounter } from '../services/encounter.js';
import { type CommandResult, commandError, abort, runMutation } from './command.js';

const BEACON_HW_NAME = 'buoy';
const BEACON_MSG_MAX = 41;

export async function serveReleaseBeacon(
    playerId: number,
    data: CommandRequest<'ReleaseBeacon'>,
): Promise<CommandResult<'ReleaseBeacon'>> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    if (player.docked || player.at_starbase) {
        return commandError('Cannot deploy a beacon while docked');
    }
    if (isInEncounter(playerId)) {
        return commandError('Resolve drone encounter first');
    }

    const message = String(data.message ?? '').slice(0, BEACON_MSG_MAX);
    const sectorDbId = player.sectorId;

    const hw = await getHardwareItemByName(BEACON_HW_NAME);
    if (!hw) {
        return commandError('Marker beacon hardware not configured');
    }

    return runMutation(
        'Release beacon',
        async (client) => {
            const cap = await getShipHardwareCapacityForUpdate(playerId, hw.id, client);
            if (!cap || cap.current_qty <= 0) {
                throw abort({
                    outcome: 'noBeacons',
                    sector: player.sector,
                    beaconsRemaining: cap?.current_qty ?? 0,
                });
            }
            await decrementShipHardwareQuantity(cap.ship_id, hw.id, 1, client);

            const existing = await getSectorBeaconForUpdate(sectorDbId, client);
            if (existing) {
                await deleteSectorBeacon(sectorDbId, client);
                return { outcome: 'collision' as const, remaining: cap.current_qty - 1 };
            }
            await insertSectorBeacon(sectorDbId, message, playerId, null, client);
            return { outcome: 'launched' as const, remaining: cap.current_qty - 1 };
        },
        (result) => ({
            outcome: result.outcome,
            sector: player.sector,
            beaconsRemaining: result.remaining,
        }),
    );
}

export async function serveAttackBeacon(playerId: number): Promise<CommandResult<'AttackBeacon'>> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    if (player.docked || player.at_starbase) {
        return commandError('Cannot attack while docked');
    }
    if (isInEncounter(playerId)) {
        return commandError('Resolve drone encounter first');
    }

    const sectorDbId = player.sectorId;

    return runMutation(
        'Attack beacon',
        async (client) => {
            const existing = await getSectorBeaconForUpdate(sectorDbId, client);
            if (!existing) {
                throw abort(commandError('No beacon to attack'));
            }
            const drones = await getShipDronesForUpdate(playerId, client);
            if (drones === undefined || drones <= 0) {
                throw abort(commandError('No drones to launch'));
            }
            await deleteSectorBeacon(sectorDbId, client);
            const newDrones = drones - 1;
            await setShipDrones(playerId, newDrones, client);
            return { destroyed: true as const, shipDrones: newDrones };
        },
        (result) => ({
            destroyed: result.destroyed,
            shipDrones: result.shipDrones,
        }),
    );
}

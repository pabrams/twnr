import type { CommandRequest } from '@twnr/shared';
import { requireOnlinePlayer } from '../state/players.js';

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
import { type CommandResult, commandRefusal, mutateAndReply } from './command.js';

const BEACON_HW_NAME = 'buoy';
export async function serveReleaseBeacon(
    playerId: number,
    data: CommandRequest<'ReleaseBeacon'>,
): Promise<CommandResult<'ReleaseBeacon'>> {
    const player = requireOnlinePlayer(playerId);

    if (player.docked || player.at_starbase) {
        return commandRefusal('docked');
    }
    if (isInEncounter(playerId)) {
        return commandRefusal('inEncounter');
    }

    const message = data.message;
    const sectorDbId = player.sectorId;

    const hw = await getHardwareItemByName(BEACON_HW_NAME);
    if (!hw) {
        throw new Error('Marker beacon hardware not configured');
    }

    return mutateAndReply(
        async (client, abort) => {
            const cap = await getShipHardwareCapacityForUpdate(playerId, hw.id, client);
            if (!cap || cap.current_qty <= 0) throw abort(commandRefusal('noBeacons'));
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
    const player = requireOnlinePlayer(playerId);

    if (player.docked || player.at_starbase) {
        return commandRefusal('docked');
    }
    if (isInEncounter(playerId)) {
        return commandRefusal('inEncounter');
    }

    const sectorDbId = player.sectorId;

    return mutateAndReply(
        async (client, abort) => {
            const existing = await getSectorBeaconForUpdate(sectorDbId, client);
            if (!existing) {
                throw abort(commandRefusal('noBeacon'));
            }
            const drones = await getShipDronesForUpdate(playerId, client);
            if (drones === undefined || drones <= 0) {
                throw abort(commandRefusal('noDronesToLaunch'));
            }
            await deleteSectorBeacon(sectorDbId, client);
            const newDrones = drones - 1;
            await setShipDrones(playerId, newDrones, client);
            return { destroyed: true as const, shipDrones: newDrones };
        },
        (result) => ({
            outcome: 'ok',
            destroyed: result.destroyed,
            shipDrones: result.shipDrones,
        }),
    );
}

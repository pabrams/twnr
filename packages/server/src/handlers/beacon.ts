import { ServerTag } from '@twnr/shared';
import type { ReleaseBeaconCommand } from '@twnr/shared';
import { players } from '../state/players.js';
import { sendEnvelope, sendError } from '../state/messaging.js';
import { withTransaction, AbortTransaction } from '../db/index.js';
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
import {
    getShipDronesForUpdate,
    setShipDrones,
} from '../db/queries/ship.js';
import { isInEncounter } from '../services/encounter.js';

const BEACON_HW_NAME = 'buoy';
const BEACON_MSG_MAX = 41;

export async function serveReleaseBeacon(
    playerId: number,
    data: ReleaseBeaconCommand,
): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (player.docked || player.at_starbase) {
        sendError(playerId, 'Cannot deploy a beacon while docked');
        return;
    }
    if (await isInEncounter(playerId)) {
        sendError(playerId, 'Resolve drone encounter first');
        return;
    }

    const message = String(data.message ?? '').slice(0, BEACON_MSG_MAX);
    const sectorDbId = player.sectorId;

    const hw = await getHardwareItemByName(BEACON_HW_NAME);
    if (!hw) {
        sendError(playerId, 'Marker beacon hardware not configured');
        return;
    }

    try {
        const result = await withTransaction(async (client) => {
            const cap = await getShipHardwareCapacityForUpdate(playerId, hw.id, client);
            if (!cap || cap.current_qty <= 0) {
                sendEnvelope(playerId, {
                    type: ServerTag.ReleaseBeaconResult,
                    outcome: 'noBeacons',
                    sector: player.sector,
                    beaconsRemaining: cap?.current_qty ?? 0,
                });
                throw new AbortTransaction();
            }
            await decrementShipHardwareQuantity(cap.ship_id, hw.id, 1, client);

            const existing = await getSectorBeaconForUpdate(sectorDbId, client);
            if (existing) {
                await deleteSectorBeacon(sectorDbId, client);
                return { outcome: 'collision' as const, remaining: cap.current_qty - 1 };
            }
            await insertSectorBeacon(sectorDbId, message, playerId, null, client);
            return { outcome: 'launched' as const, remaining: cap.current_qty - 1 };
        });
        if (!result) return;

        sendEnvelope(playerId, {
            type: ServerTag.ReleaseBeaconResult,
            outcome: result.outcome,
            sector: player.sector,
            beaconsRemaining: result.remaining,
        });
    } catch (err) {
        if (err instanceof AbortTransaction) return;
        console.error('Release beacon error', err);
        sendError(playerId, 'Internal server error');
    }
}

export async function serveAttackBeacon(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (player.docked || player.at_starbase) {
        sendError(playerId, 'Cannot attack while docked');
        return;
    }
    if (await isInEncounter(playerId)) {
        sendError(playerId, 'Resolve drone encounter first');
        return;
    }

    const sectorDbId = player.sectorId;

    try {
        const result = await withTransaction(async (client) => {
            const existing = await getSectorBeaconForUpdate(sectorDbId, client);
            if (!existing) {
                sendError(playerId, 'No beacon to attack');
                throw new AbortTransaction();
            }
            const drones = await getShipDronesForUpdate(playerId, client);
            if (drones === undefined || drones <= 0) {
                sendError(playerId, 'No drones to launch');
                throw new AbortTransaction();
            }
            await deleteSectorBeacon(sectorDbId, client);
            const newDrones = drones - 1;
            await setShipDrones(playerId, newDrones, client);
            return { destroyed: true as const, shipDrones: newDrones };
        });
        if (!result) return;
        sendEnvelope(playerId, {
            type: ServerTag.AttackBeaconResult,
            destroyed: result.destroyed,
            shipDrones: result.shipDrones,
        });
    } catch (err) {
        if (err instanceof AbortTransaction) return;
        console.error('Attack beacon error', err);
        sendError(playerId, 'Internal server error');
    }
}

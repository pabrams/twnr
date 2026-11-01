import type { CommandRequest } from '@twnr/shared';
import { onlinePlayers } from '../state/players.js';
import { isInEncounter } from '../services/encounter.js';
import { refreshSectorObservation } from '../services/sector-observations.js';
import { ownershipFrom } from '../services/owner-format.js';

import { getGraph } from '../state/graph-cache.js';
import { getSectorDbId } from '../db/queries/sector.js';
import {
    getHardwareItemByName,
    getShipHardwareCapacityForUpdate,
    decrementShipHardwareByName,
    decrementShipHardwareQuantity,
    getShipHardwareQuantityByName,
    upsertShipHardwareQuantity,
} from '../db/queries/hardware.js';
import {
    getSectorMine,
    getSectorMineForUpdate,
    setSectorMineTo,
    setSectorMineQuantity,
    deleteSectorMines,
    getDeployedMinesByOwner,
    getSeekerAttachmentsByOwner,
    getMineUniverseSettings,
    type MineType,
} from '../db/queries/mines.js';
import { getPlayerClanId } from '../db/queries/clan.js';
import { isFriendlyOwner } from '../services/owner.js';
import { type CommandResult, commandRefusal, mutateAndReply } from './command.js';

const MINE_TYPE_TO_HARDWARE: Record<MineType, string> = {
    proximity: 'proximity_mine',
    seeker: 'seeker_mine',
};

export async function serveDeployMineInfo(
    playerId: number,
    data: CommandRequest<'DeployMineInfo'>,
): Promise<CommandResult<'DeployMineInfo'>> {
    const { mineType } = data;
    const player = onlinePlayers[playerId];
    if (!player) return;
    if (player.docked || player.at_starbase) {
        return commandRefusal('docked');
    }
    if (isInEncounter(playerId)) {
        return commandRefusal('inEncounter');
    }

    const sectorDbId = player.sectorId;

    const itemName = MINE_TYPE_TO_HARDWARE[mineType];
    const hw = await getHardwareItemByName(itemName);
    if (!hw) {
        throw new Error('Mine hardware not configured');
    }

    const playerClanId = await getPlayerClanId(playerId);
    const existing = await getSectorMine(sectorDbId, mineType);
    if (existing && existing.quantity > 0 && !isFriendlyOwner(existing, playerId, playerClanId)) {
        return commandRefusal('notYourMines', { mineType });
    }

    const cap = await getShipHardwareCapacityForUpdate(playerId, hw.id);
    if (!cap) {
        return commandRefusal('noShip');
    }

    return {
        mineType,
        sectorMines: existing?.quantity ?? 0,
        shipMines: cap.current_qty,
        shipMaxMines: cap.max_qty,
    };
}

export async function serveDeployMine(
    playerId: number,
    data: CommandRequest<'DeployMine'>,
): Promise<CommandResult<'DeployMine'>> {
    const { mineType } = data;
    const target = data.quantity;
    const ownership: 'personal' | 'clan' = data.ownership ?? 'personal';

    const player = onlinePlayers[playerId];
    if (!player) return;
    if (player.docked || player.at_starbase) {
        return commandRefusal('docked');
    }
    if (isInEncounter(playerId)) {
        return commandRefusal('inEncounter');
    }

    const sectorDbId = player.sectorId;

    const itemName = MINE_TYPE_TO_HARDWARE[mineType];
    const hw = await getHardwareItemByName(itemName);
    if (!hw) {
        throw new Error('Mine hardware not configured');
    }

    const playerClanId = await getPlayerClanId(playerId);
    if (ownership === 'clan' && playerClanId === null) {
        return commandRefusal('notInClan');
    }

    return mutateAndReply(
        async (client, abort) => {
            const existing = await getSectorMineForUpdate(sectorDbId, mineType, client);
            const currentInSector = existing?.quantity ?? 0;

            // Re-check ownership under lock.
            if (existing && existing.quantity > 0) {
                const friendly = isFriendlyOwner(existing, playerId, playerClanId);
                if (!friendly) {
                    throw abort(commandRefusal('notYourMines', { mineType }));
                }
            }

            const cap = await getShipHardwareCapacityForUpdate(playerId, hw.id, client);
            if (!cap) {
                throw abort(commandRefusal('noShip'));
            }

            const totalAvailable = currentInSector + cap.current_qty;
            const minInSector = Math.max(0, totalAvailable - cap.max_qty);
            const resolvedTarget = target === -1 ? minInSector : target;

            const delta = resolvedTarget - currentInSector;

            if (delta > 0) {
                if (cap.current_qty < delta) {
                    throw abort(
                        commandRefusal('insufficientMines', { have: cap.current_qty, mineType }),
                    );
                }
                await decrementShipHardwareQuantity(cap.ship_id, hw.id, delta, client);
            } else if (delta < 0) {
                const pickup = -delta;
                if (cap.current_qty + pickup > cap.max_qty) {
                    throw abort(
                        commandRefusal('minesAtCapacity', {
                            room: cap.max_qty - cap.current_qty,
                            mineType,
                        }),
                    );
                }
                await upsertShipHardwareQuantity(cap.ship_id, hw.id, pickup, client);
            }

            const ownerPlayerArg = ownership === 'personal' ? playerId : null;
            const ownerClanArg = ownership === 'clan' ? playerClanId : null;
            await setSectorMineTo(
                sectorDbId,
                mineType,
                ownerPlayerArg,
                ownerClanArg,
                resolvedTarget,
                client,
            );

            return {
                sectorMines: resolvedTarget,
                shipMines: cap.current_qty - delta,
            };
        },
        async (result) => {
            await refreshSectorObservation(playerId, sectorDbId);
            return {
                mineType,
                sectorMines: result.sectorMines,
                shipMines: result.shipMines,
            };
        },
    );
}

export async function serveListDeployedMines(
    playerId: number,
): Promise<CommandResult<'ListDeployedMines'>> {
    const player = onlinePlayers[playerId];
    if (!player) return;
    const rows = await getDeployedMinesByOwner(playerId);
    const { formatOwner, ownershipFrom } = await import('../services/owner-format.js');
    return {
        mines: rows.map((r) => ({
            sectorNumber: r.sector_number,
            mineType: r.mine_type,
            quantity: r.quantity,
            ownerLabel: formatOwner(r),
            ownership: ownershipFrom(r),
        })),
    };
}

export async function serveTrackSeekerMines(
    playerId: number,
): Promise<CommandResult<'TrackSeekerMines'>> {
    const player = onlinePlayers[playerId];
    if (!player) return;
    const rows = await getSeekerAttachmentsByOwner(playerId);
    return {
        targets: rows.map((r) => ({
            targetShipId: r.target_ship_id,
            targetShipName: r.target_ship_type_name,
            targetOwnerName: r.target_player_name ?? 'Unknown',
            sectorNumber: r.sector_number,
            ownership: ownershipFrom(r),
        })),
    };
}

export async function serveMineDisruptor(
    playerId: number,
    data: CommandRequest<'MineDisruptor'>,
): Promise<CommandResult<'MineDisruptor'>> {
    const { targetSector } = data;
    if (!Number.isInteger(targetSector) || targetSector <= 0) {
        return commandRefusal('noSuchSector');
    }
    const player = onlinePlayers[playerId];
    if (!player) return;
    if (player.docked || player.at_starbase) {
        return commandRefusal('docked');
    }
    if (isInEncounter(playerId)) {
        return commandRefusal('inEncounter');
    }

    const warps = await getGraph(player.universeId);
    if (!warps[player.sector]?.includes(targetSector)) {
        return commandRefusal('targetNotAdjacent');
    }

    const targetSectorDbId = await getSectorDbId(targetSector, player.universeId);
    if (!targetSectorDbId) {
        return commandRefusal('noSuchSector');
    }

    const have = await getShipHardwareQuantityByName(playerId, 'mine_disruptor');
    if (have <= 0) {
        return commandRefusal('noDisruptors');
    }

    const settings = await getMineUniverseSettings(player.universeId);
    const lo = Math.max(0, settings.mine_disruptor_min);
    const hi = Math.max(lo, settings.mine_disruptor_max);
    const removeTarget = lo + Math.floor(Math.random() * (hi - lo + 1));

    return mutateAndReply(
        async (client) => {
            const mineRow = await getSectorMineForUpdate(targetSectorDbId, 'proximity', client);
            const existing = mineRow?.quantity ?? 0;
            const removed = Math.min(existing, removeTarget);
            const remaining = existing - removed;

            if (mineRow) {
                if (remaining <= 0) {
                    await deleteSectorMines(targetSectorDbId, 'proximity', client);
                } else {
                    await setSectorMineQuantity(targetSectorDbId, 'proximity', remaining, client);
                }
            }

            await decrementShipHardwareByName(playerId, 'mine_disruptor', client);

            return { removed, remaining };
        },
        async (result) => {
            await refreshSectorObservation(playerId, targetSectorDbId);
            return {
                targetSector,
                minesDisrupted: result.removed,
                proximityMinesRemaining: result.remaining,
            };
        },
    );
}

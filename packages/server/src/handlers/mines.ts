import { ServerMsgType } from '@twnr/shared';
import type { DeployMineInfoCommand, DeployMineCommand, MineDisruptorCommand } from '@twnr/shared';
import { players } from '../state/players.js';
import { sendEnvelope, sendError } from '../state/messaging.js';
import { isInEncounter } from '../services/encounter.js';
import { withTransaction, AbortTransaction } from '../db/index.js';
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

const MINE_TYPE_TO_HARDWARE: Record<MineType, string> = {
    proximity: 'proximity_mine',
    seeker: 'seeker_mine',
};

const MINE_TYPE_LABEL: Record<MineType, string> = {
    proximity: 'Proximity',
    seeker: 'Seeker',
};

/** Info-only roundtrip used by the client's Handle-Mines flow. Reports
 *  the current ship/sector counts and the ship's max capacity for the
 *  given mine type, so the client can prompt for a target total. If the
 *  sector already contains mines of this type that the player can't
 *  legitimately manipulate (not theirs, not their clan's), we reject
 *  here — before the client asks for quantity or ownership. */
export async function handleDeployMineInfo(
    playerId: number,
    data: DeployMineInfoCommand,
): Promise<void> {
    const { mineType } = data;
    if (mineType !== 'proximity' && mineType !== 'seeker') {
        sendError(playerId, 'Invalid mine type');
        return;
    }
    const player = players[playerId];
    if (!player) return;
    if (player.docked || player.at_starbase) {
        sendError(playerId, 'Cannot deploy mines while docked');
        return;
    }
    if (await isInEncounter(playerId)) {
        sendError(playerId, 'Resolve drone encounter first');
        return;
    }

    const sectorDbId = await getSectorDbId(player.sector, player.universeId);
    if (!sectorDbId) {
        sendError(playerId, 'Sector not found');
        return;
    }

    const itemName = MINE_TYPE_TO_HARDWARE[mineType];
    const hw = await getHardwareItemByName(itemName);
    if (!hw) {
        sendError(playerId, 'Mine hardware not configured');
        return;
    }

    const playerClanId = await getPlayerClanId(playerId);
    const existing = await getSectorMine(sectorDbId, mineType);
    if (existing && existing.quantity > 0 && !isFriendlyOwner(existing, playerId, playerClanId)) {
        sendError(playerId, `Those ${MINE_TYPE_LABEL[mineType]} mines aren't yours`);
        return;
    }

    const cap = await getShipHardwareCapacityForUpdate(playerId, hw.id);
    if (!cap) {
        sendError(playerId, 'Ship not found');
        return;
    }

    sendEnvelope(playerId, {
        type: ServerMsgType.DeployMineInfoResult,
        mineType,
        sectorMines: existing?.quantity ?? 0,
        shipMines: cap.current_qty,
        shipMaxMines: cap.max_qty,
    });
}

/** Deploy/pickup mines. `target` is the desired total in the sector
 *  after the operation; -1 = "deploy all from ship." The transaction
 *  re-checks ownership (the friendly-check in `handleDeployMineInfo`
 *  was earlier and the world may have moved) and computes the delta:
 *  positive moves ship→sector, negative picks up sector→ship. */
export async function handleDeployMine(
    playerId: number,
    data: DeployMineCommand,
): Promise<void> {
    const { mineType } = data;
    const target = data.quantity;
    const ownership: 'personal' | 'clan' = data.ownership ?? 'personal';
    if (mineType !== 'proximity' && mineType !== 'seeker') {
        sendError(playerId, 'Invalid mine type');
        return;
    }
    if (!Number.isInteger(target) || target < -1) {
        sendError(playerId, 'Invalid quantity');
        return;
    }

    const player = players[playerId];
    if (!player) return;
    if (player.docked || player.at_starbase) {
        sendError(playerId, 'Cannot deploy mines while docked');
        return;
    }
    if (await isInEncounter(playerId)) {
        sendError(playerId, 'Resolve drone encounter first');
        return;
    }

    const sectorDbId = await getSectorDbId(player.sector, player.universeId);
    if (!sectorDbId) {
        sendError(playerId, 'Sector not found');
        return;
    }

    const itemName = MINE_TYPE_TO_HARDWARE[mineType];
    const hw = await getHardwareItemByName(itemName);
    if (!hw) {
        sendError(playerId, 'Mine hardware not configured');
        return;
    }

    const playerClanId = await getPlayerClanId(playerId);
    if (ownership === 'clan' && playerClanId === null) {
        sendError(playerId, 'You are not in a clan.');
        return;
    }

    try {
        const result = await withTransaction(async (client) => {
            const existing = await getSectorMineForUpdate(sectorDbId, mineType, client);
            const currentInSector = existing?.quantity ?? 0;

            // Re-check ownership inside the tx: the info-time friendly
            // check could be stale (another player may have cleared/
            // deployed in the meantime).
            if (existing && existing.quantity > 0) {
                const friendly = isFriendlyOwner(existing, playerId, playerClanId);
                if (!friendly) {
                    sendError(
                        playerId,
                        `Those ${MINE_TYPE_LABEL[mineType]} mines aren't yours`,
                    );
                    throw new AbortTransaction();
                }
            }

            const cap = await getShipHardwareCapacityForUpdate(playerId, hw.id, client);
            if (!cap) {
                sendError(playerId, 'Ship not found');
                throw new AbortTransaction();
            }

            // Default (-1): deploy every mine of this type from the ship,
            // leaving the ship empty of this type.
            const resolvedTarget =
                target === -1 ? currentInSector + cap.current_qty : target;

            const delta = resolvedTarget - currentInSector;

            if (delta > 0) {
                if (cap.current_qty < delta) {
                    sendError(
                        playerId,
                        `Only ${cap.current_qty} ${MINE_TYPE_LABEL[mineType]} mines on ship`,
                    );
                    throw new AbortTransaction();
                }
                await decrementShipHardwareQuantity(cap.ship_id, hw.id, delta, client);
            } else if (delta < 0) {
                const pickup = -delta;
                if (cap.current_qty + pickup > cap.max_qty) {
                    sendError(
                        playerId,
                        `Ship can hold only ${cap.max_qty - cap.current_qty} more ${MINE_TYPE_LABEL[mineType]} mines`,
                    );
                    throw new AbortTransaction();
                }
                await upsertShipHardwareQuantity(cap.ship_id, hw.id, pickup, client);
            }

            // Write the sector row: explicit target (or delete on 0),
            // with the chosen ownership applied. When delta === 0 this
            // still flips owner cols if ownership differs from existing.
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
        });

        if (!result) return;

        await sendEnvelope(playerId, {
            type: ServerMsgType.DeployMineResult,
            mineType,
            sectorMines: result.sectorMines,
            shipMines: result.shipMines,
        });
    } catch (err) {
        console.error('Deploy mine error', err);
        sendError(playerId, 'Internal server error');
    }
}

export async function handleListDeployedMines(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;
    const rows = await getDeployedMinesByOwner(playerId);
    const { formatOwner } = await import('../services/owner-format.js');
    sendEnvelope(playerId, {
        type: ServerMsgType.ListDeployedMinesResult,
        mines: rows.map((r) => ({
            sectorNumber: r.sector_number,
            mineType: r.mine_type,
            quantity: r.quantity,
            ownerLabel: formatOwner(r),
        })),
    });
}

export async function handleTrackSeekerMines(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;
    const rows = await getSeekerAttachmentsByOwner(playerId);
    sendEnvelope(playerId, {
        type: ServerMsgType.TrackSeekerMinesResult,
        targets: rows.map((r) => ({
            targetShipId: r.target_ship_id,
            targetShipName: r.target_ship_type_name,
            targetOwnerName: r.target_player_name ?? 'Unknown',
            sectorNumber: r.sector_number,
        })),
    });
}

export async function handleMineDisruptor(
    playerId: number,
    data: MineDisruptorCommand,
): Promise<void> {
    const { targetSector } = data;
    if (!Number.isInteger(targetSector) || targetSector <= 0) {
        sendError(playerId, 'Invalid target sector');
        return;
    }
    const player = players[playerId];
    if (!player) return;
    if (player.docked || player.at_starbase) {
        sendError(playerId, 'Cannot fire disruptor while docked');
        return;
    }
    if (await isInEncounter(playerId)) {
        sendError(playerId, 'Resolve drone encounter first');
        return;
    }

    // Adjacency check.
    const warps = await getGraph(player.universeId);
    if (!warps[player.sector]?.includes(targetSector)) {
        sendError(playerId, 'Target sector is not adjacent');
        return;
    }

    const targetSectorDbId = await getSectorDbId(targetSector, player.universeId);
    if (!targetSectorDbId) {
        sendError(playerId, 'Sector not found');
        return;
    }

    // Ensure player has at least one disruptor.
    const have = await getShipHardwareQuantityByName(playerId, 'mine_disruptor');
    if (have <= 0) {
        sendError(playerId, 'No mine disruptors on ship');
        return;
    }

    const settings = await getMineUniverseSettings(player.universeId);
    // Inclusive uniform random in [min, max].
    const lo = Math.max(0, settings.mine_disruptor_min);
    const hi = Math.max(lo, settings.mine_disruptor_max);
    const removeTarget = lo + Math.floor(Math.random() * (hi - lo + 1));

    try {
        const result = await withTransaction(async (client) => {
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

            // Disruptor itself is consumed regardless of outcome.
            await decrementShipHardwareByName(playerId, 'mine_disruptor', client);

            return { removed, remaining };
        });

        if (!result) return;

        await sendEnvelope(playerId, {
            type: ServerMsgType.MineDisruptorResult,
            targetSector,
            minesDisrupted: result.removed,
            proximityMinesRemaining: result.remaining,
        });
    } catch (err) {
        console.error('Mine disruptor error', err);
        sendError(playerId, 'Internal server error');
    }
}

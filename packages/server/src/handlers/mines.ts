import { ServerMsgType } from '@twnr/shared';
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
    getShipHardwareQuantityByName,
} from '../db/queries/hardware.js';
import {
    getSectorMineForUpdate,
    upsertSectorMines,
    setSectorMineQuantity,
    deleteSectorMines,
    getDeployedMinesByOwner,
    getSeekerAttachmentsByOwner,
    getMineUniverseSettings,
    type MineType,
} from '../db/queries/mines.js';

const MINE_TYPE_TO_HARDWARE: Record<MineType, string> = {
    proximity: 'proximity_mine',
    seeker: 'seeker_mine',
};

const MINE_TYPE_LABEL: Record<MineType, string> = {
    proximity: 'Proximity',
    seeker: 'Seeker',
};

export async function handleDeployMine(
    playerId: number,
    mineType: MineType,
    quantity: number,
    ownership: 'personal' | 'clan' = 'personal',
): Promise<void> {
    if (mineType !== 'proximity' && mineType !== 'seeker') {
        sendError(playerId, 'Invalid mine type');
        return;
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
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

    let playerClanId: number | null = null;
    if (ownership === 'clan') {
        const { pool } = await import('../db/index.js');
        const r = await pool.query<{ clan_id: number | null }>(
            'SELECT clan_id FROM players WHERE id = $1',
            [playerId],
        );
        playerClanId = r.rows[0]?.clan_id ?? null;
        if (playerClanId === null) {
            sendError(playerId, 'You are not in a clan.');
            return;
        }
    }

    try {
        const result = await withTransaction(async (client) => {
            const existing = await getSectorMineForUpdate(sectorDbId, mineType, client);
            if (existing && existing.quantity > 0) {
                const matches =
                    (ownership === 'personal' && existing.owner_player_id === playerId) ||
                    (ownership === 'clan' && existing.owner_clan_id === playerClanId);
                if (!matches) {
                    const friendly =
                        existing.owner_player_id === playerId ||
                        (playerClanId !== null && existing.owner_clan_id === playerClanId);
                    sendError(
                        playerId,
                        friendly
                            ? `Sector already has ${MINE_TYPE_LABEL[mineType]} mines with different ownership.`
                            : `Sector contains hostile ${MINE_TYPE_LABEL[mineType]} mines — clear them first`,
                    );
                    throw new AbortTransaction();
                }
            }

            const cap = await getShipHardwareCapacityForUpdate(playerId, hw.id, client);
            if (!cap) {
                sendError(playerId, 'Ship not found');
                throw new AbortTransaction();
            }
            if (cap.current_qty < quantity) {
                sendError(
                    playerId,
                    `Only ${cap.current_qty} ${MINE_TYPE_LABEL[mineType]} mines on ship`,
                );
                throw new AbortTransaction();
            }

            // Deduct from ship hardware (decrement by quantity).
            await client.query(
                `UPDATE ship_hardware SET quantity = quantity - $1
                 WHERE ship_id = $2 AND hardware_item_id = $3`,
                [quantity, cap.ship_id, hw.id],
            );

            // Add to sector mines.
            await upsertSectorMines(
                sectorDbId,
                mineType,
                ownership === 'personal' ? playerId : null,
                ownership === 'clan' ? playerClanId : null,
                quantity,
                client,
            );

            const newSectorTotal = (existing?.quantity ?? 0) + quantity;
            return {
                shipRemaining: cap.current_qty - quantity,
                sectorTotal: newSectorTotal,
            };
        });

        if (!result) return;

        await sendEnvelope(playerId, {
            type: ServerMsgType.DeployMineResult,
            mineType,
            deployed: quantity,
            sectorTotal: result.sectorTotal,
            shipRemaining: result.shipRemaining,
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

export async function handleMineDisruptor(playerId: number, targetSector: number): Promise<void> {
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

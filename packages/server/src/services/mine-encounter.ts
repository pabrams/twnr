import { ServerTag } from '@twnr/shared';
import { onlinePlayers } from '../state/players.js';
import { sendEnvelope, broadcastEnvelope } from '../state/messaging.js';
import { getClanMembers } from '../db/queries/clan.js';
import { withTransaction } from '../db/index.js';
import {
    getSectorMineForUpdate,
    setSectorMineQuantity,
    deleteSectorMines,
    getSeekerAttachmentForUpdate,
    upsertSeekerAttachment,
    deleteSeekerAttachment,
    getMineUniverseSettings,
} from '../db/queries/mines.js';
import {
    getShipDronesAndShieldsForUpdate,
    setShipDronesAndShields,
    destroyShipRecord,
} from '../db/queries/ship.js';
import { getPlayerClanId } from '../db/queries/clan.js';
import { getPlayerShipId } from '../db/queries/player.js';
import { isFriendlyOwner } from './owner.js';

/** RNG-of-record. Tests can monkey-patch Math.random to make outcomes deterministic. */
function rollPercent(pct: number): boolean {
    if (pct <= 0) return false;
    if (pct >= 100) return true;
    return Math.random() * 100 < pct;
}

export type ProximityHitResult = {
    detonations: number;
    damage: number;
    shieldsLost: number;
    dronesLost: number;
    destroyed: boolean;
};

export async function resolveProximityMines(playerId: number): Promise<ProximityHitResult | null> {
    const player = onlinePlayers[playerId];
    if (!player) return null;

    const sectorDbId = player.sectorId;

    const settings = await getMineUniverseSettings(player.universeId);
    if (settings.proximity_detonation_pct <= 0 || settings.proximity_mine_damage <= 0) return null;

    const playerClanId = await getPlayerClanId(playerId);

    const result = await withTransaction(async (client) => {
        const mineRow = await getSectorMineForUpdate(sectorDbId, 'proximity', client);
        if (!mineRow || mineRow.quantity <= 0) return null;
        // Player's own (or clan's) mines never detonate against them.
        if (isFriendlyOwner(mineRow, playerId, playerClanId)) return null;

        // Roll each mine independently.
        let detonations = 0;
        for (let i = 0; i < mineRow.quantity; i++) {
            if (rollPercent(settings.proximity_detonation_pct)) detonations++;
        }
        if (detonations === 0) return null;

        const remaining = mineRow.quantity - detonations;
        if (remaining <= 0) {
            await deleteSectorMines(sectorDbId, 'proximity', client);
        } else {
            await setSectorMineQuantity(sectorDbId, 'proximity', remaining, client);
        }

        // Apply damage: first drones, then shields.
        const shipState = await getShipDronesAndShieldsForUpdate(playerId, client);
        if (!shipState) {
            return { detonations, damage: 0, shieldsLost: 0, dronesLost: 0, destroyed: false };
        }
        const damage = detonations * settings.proximity_mine_damage;
        let remainingDamage = damage;
        const dronesLost = Math.min(shipState.drones, remainingDamage);
        remainingDamage -= dronesLost;
        const shieldsLost = Math.min(shipState.shields, remainingDamage);
        remainingDamage -= shieldsLost;
        const newShields = shipState.shields - shieldsLost;
        const newDrones = shipState.drones - dronesLost;
        const destroyed = remainingDamage > 0;

        if (destroyed) {
            await destroyShipRecord(playerId, client);
        } else {
            await setShipDronesAndShields(playerId, newDrones, newShields, client);
        }

        return { detonations, damage, shieldsLost, dronesLost, destroyed };
    });

    if (!result) return null;
    sendEnvelope(playerId, {
        type: ServerTag.ProximityMineHit,
        sector: player.sector,
        detonations: result.detonations,
        damage: result.damage,
        shieldsLost: result.shieldsLost,
        dronesLost: result.dronesLost,
        destroyed: result.destroyed,
    });
    return result;
}

export async function resolveSeekerMines(playerId: number): Promise<{
    newOwnerPlayerId: number | null;
    newOwnerClanId: number | null;
    droppedPrevious: boolean;
} | null> {
    const player = onlinePlayers[playerId];
    if (!player) return null;

    const sectorDbId = player.sectorId;

    const settings = await getMineUniverseSettings(player.universeId);
    const playerClanId = await getPlayerClanId(playerId);

    const outcome = await withTransaction(async (client) => {
        const mineRow = await getSectorMineForUpdate(sectorDbId, 'seeker', client);
        if (!mineRow || mineRow.quantity <= 0) return null;
        if (isFriendlyOwner(mineRow, playerId, playerClanId)) return null;

        const shipId = await getPlayerShipId(playerId, client);
        if (!shipId) return null;

        // Exactly one limpet attaches; exactly one mine consumed.
        const remaining = mineRow.quantity - 1;
        if (remaining <= 0) {
            await deleteSectorMines(sectorDbId, 'seeker', client);
        } else {
            await setSectorMineQuantity(sectorDbId, 'seeker', remaining, client);
        }

        const previous = await getSeekerAttachmentForUpdate(shipId, client);
        const droppedPrevious = previous != null;
        if (droppedPrevious) {
            await deleteSeekerAttachment(shipId, client);
        }

        await upsertSeekerAttachment(
            shipId,
            mineRow.owner_player_id,
            mineRow.owner_clan_id,
            client,
        );

        return {
            newOwnerPlayerId: mineRow.owner_player_id,
            newOwnerClanId: mineRow.owner_clan_id,
            droppedPrevious,
        };
    });

    if (!outcome) return null;

    // Audible cue to the victim — gated on the new notice probability. When
    // the roll fails the limpet still attached, just silently.
    if (rollPercent(settings.seeker_victim_notice_pct)) {
        sendEnvelope(playerId, {
            type: ServerTag.SeekerMineAttached,
            sector: player.sector,
            droppedPrevious: outcome.droppedPrevious,
        });
    }

    // Deployer is always alerted in real time (single player → them; clan-
    // owned → broadcast to all online clan members).
    const alert = {
        type: ServerTag.SeekerMinePickupAlert,
        sector: player.sector,
        targetShipName: 'unknown',
        targetOwnerName: player.name,
    };
    if (outcome.newOwnerPlayerId !== null) {
        sendEnvelope(outcome.newOwnerPlayerId, alert);
    } else if (outcome.newOwnerClanId !== null) {
        const members = await getClanMembers(outcome.newOwnerClanId);
        broadcastEnvelope(
            alert,
            members.map((m) => m.id),
        );
    }

    // Mail entry for the limpet's owner (or each clan member if clan-owned)
    // so the activation persists even for offline owners.
    const { insertSystemMemo } = await import('../db/queries/message.js');
    const activationBody = `Limpet mine in ${player.sector} activated.`;
    if (outcome.newOwnerPlayerId !== null) {
        await insertSystemMemo(
            outcome.newOwnerPlayerId,
            'Deployed Drones',
            'limpet_activated',
            activationBody,
        );
    } else if (outcome.newOwnerClanId !== null) {
        const members = await getClanMembers(outcome.newOwnerClanId);
        for (const m of members) {
            await insertSystemMemo(m.id, 'Deployed Drones', 'limpet_activated', activationBody);
        }
    }

    return outcome;
}

export async function resolveMinesOnEntry(playerId: number): Promise<{ destroyed: boolean }> {
    const proxResult = await resolveProximityMines(playerId);
    if (proxResult?.destroyed) return { destroyed: true };
    await resolveSeekerMines(playerId);
    return { destroyed: false };
}

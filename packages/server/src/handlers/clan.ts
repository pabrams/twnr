import type { PoolClient } from 'pg';
import { type GameEvent, type GameEventClanRef, type Refusal, Events } from '@twnr/shared';
import type { CommandRequest } from '@twnr/shared';
import { withTransaction } from '../db/index.js';

import { sendEnvelope } from '../state/messaging.js';
import { onlinePlayers, requireOnlinePlayer } from '../state/players.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import {
    insertClan,
    getClanById,
    getClanByNameInUniverse,
    listClansInUniverse,
    getClanMembers,
    getClanmateLocations,
    getClanMemberCount,
    getMaxClanSize,
    setPlayerClanId,
    setClanLeader,
    setClanPasswordHash,
    deleteClan,
    dissolveClanAssets,
    isPlayerOnClanShip,
    getPlayerClanId,
    getPlayersClanIds,
    type ClanRow,
} from '../db/queries/clan.js';
import { insertMemo } from '../db/queries/message.js';
import { recordGameEvent } from '../services/game-events.js';
import {
    getPlayerName,
    getCreditsForUpdate,
    deductCredits,
    addCredits,
} from '../db/queries/player.js';
import {
    getShipCounterForUpdate,
    getShipCounterWithMaxForUpdate,
    adjustShipCounter,
} from '../db/queries/ship.js';
import {
    getHardwareItemByName,
    getShipHardwareCapacityForUpdate,
    decrementShipHardwareQuantity,
    upsertShipHardwareQuantity,
} from '../db/queries/hardware.js';
import { type CommandResult, type Abort, commandRefusal, mutateAndReply } from './command.js';

function clanRefOf(clan: Pick<ClanRow, 'id' | 'universe_clan_number' | 'name'>): GameEventClanRef {
    return { clanId: clan.id, clanNumber: clan.universe_clan_number, name: clan.name };
}

export async function serveClanCreate(
    playerId: number,
    data: CommandRequest<'ClanCreate'>,
): Promise<CommandResult<'ClanCreate'>> {
    const { name, password } = data;
    const player = requireOnlinePlayer(playerId);

    const trimmedName = name.trim();
    const existingClanId = await getPlayerClanId(playerId);
    if (existingClanId !== null) {
        return commandRefusal('alreadyInClan');
    }

    const existing = await getClanByNameInUniverse(trimmedName, player.universeId);
    if (existing) {
        return commandRefusal('clanNameTaken');
    }

    const passwordHash = hashPassword(password);

    return mutateAndReply(
        async (client) => {
            const inserted = await insertClan(
                player.universeId,
                trimmedName,
                passwordHash,
                playerId,
                client,
            );
            await setPlayerClanId(playerId, inserted.id, client);
            await recordGameEvent(
                player.universeId,
                {
                    kind: 'clan_created',
                    founder: { playerId, name: player.name },
                    clan: {
                        clanId: inserted.id,
                        clanNumber: inserted.universeClanNumber,
                        name: trimmedName,
                    },
                },
                client,
            );
            return inserted;
        },
        (created) => ({
            outcome: 'ok',
            clanId: created.id,
            clanNumber: created.universeClanNumber,
            name: trimmedName,
        }),
    );
}

export async function serveClanJoin(
    playerId: number,
    data: CommandRequest<'ClanJoin'>,
): Promise<CommandResult<'ClanJoin'>> {
    const { name, password } = data;
    const player = requireOnlinePlayer(playerId);

    const existingClanId = await getPlayerClanId(playerId);
    if (existingClanId !== null) {
        return commandRefusal('alreadyInClan');
    }

    const clan = await getClanByNameInUniverse(name.trim(), player.universeId);
    if (!clan) {
        return commandRefusal('clanNotFound');
    }
    if (!verifyPassword(password, clan.password_hash)) {
        return commandRefusal('wrongClanPassword');
    }

    const [memberCount, maxSize] = await Promise.all([
        getClanMemberCount(clan.id),
        getMaxClanSize(player.universeId),
    ]);
    if (memberCount >= maxSize) {
        return commandRefusal('clanFull', { max: maxSize });
    }

    return mutateAndReply(
        async (client) => {
            await setPlayerClanId(playerId, clan.id, client);
            await recordGameEvent(
                player.universeId,
                {
                    kind: 'player_joined_clan',
                    player: { playerId, name: player.name },
                    clan: clanRefOf(clan),
                },
                client,
            );
            return true;
        },
        () => ({
            outcome: 'ok',
            clanId: clan.id,
            clanNumber: clan.universe_clan_number,
            name: clan.name,
        }),
    );
}

export async function serveClanLeave(
    playerId: number,
    data: CommandRequest<'ClanLeave'>,
): Promise<CommandResult<'ClanLeave'>> {
    const successorPlayerId = data.successorPlayerId;
    const confirmDissolve = data.confirmDissolve === true;
    const player = requireOnlinePlayer(playerId);

    const clanId = await getPlayerClanId(playerId);
    if (clanId === null) {
        return commandRefusal('notInClan');
    }

    const clan = await getClanById(clanId);
    if (!clan) {
        return commandRefusal('clanNotFound');
    }

    const memberCount = await getClanMemberCount(clanId);
    const isLastMember = memberCount <= 1;

    const leftClanEvent: GameEvent = {
        kind: 'player_left_clan',
        player: { playerId, name: player.name },
        clan: clanRefOf(clan),
    };

    if (isLastMember) {
        if (!confirmDissolve) {
            return commandRefusal('confirmDissolution');
        }
        return mutateAndReply(
            async (client) => {
                const stats = await dissolveClanAssets(clanId, playerId, player.sectorId, client);
                await setPlayerClanId(playerId, null, client);
                await deleteClan(clanId, client);
                await recordGameEvent(player.universeId, leftClanEvent, client);
                await recordGameEvent(
                    player.universeId,
                    {
                        kind: 'clan_disbanded',
                        clan: clanRefOf(clan),
                        lastMember: { playerId, name: player.name },
                    },
                    client,
                );
                return stats;
            },
            (result) => ({
                outcome: 'dissolved',
                convertedToPersonal: result.convertedToPersonal,
                convertedToRogue: result.convertedToRogue,
            }),
        );
    }

    if (await isPlayerOnClanShip(playerId, clanId)) {
        return commandRefusal('onClanShip');
    }

    const isLeader = clan.leader_id === playerId;

    if (isLeader) {
        if (successorPlayerId === undefined) {
            return commandRefusal('successorRequired');
        }
        const members = await getClanMembers(clanId);
        const successor = members.find((m) => m.id === successorPlayerId && m.id !== playerId);
        if (!successor) {
            return commandRefusal('notClanMember');
        }
        return mutateAndReply(
            async (client) => {
                await setClanLeader(clanId, successor.id, client);
                await setPlayerClanId(playerId, null, client);
                await recordGameEvent(player.universeId, leftClanEvent, client);
                return true;
            },
            () => ({
                outcome: 'left',
                convertedToPersonal: 0,
                convertedToRogue: 0,
            }),
        );
    }

    return mutateAndReply(
        async (client) => {
            await setPlayerClanId(playerId, null, client);
            await recordGameEvent(player.universeId, leftClanEvent, client);
            return true;
        },
        () => ({
            outcome: 'left',
            convertedToPersonal: 0,
            convertedToRogue: 0,
        }),
    );
}

export async function serveClanList(playerId: number): Promise<CommandResult<'ClanList'>> {
    const player = requireOnlinePlayer(playerId);

    const rows = await listClansInUniverse(player.universeId);
    const viewerClanId = await getPlayerClanId(playerId);
    return {
        outcome: 'ok',
        viewerClanId,
        clans: rows.map((r) => ({
            clanId: r.id,
            clanNumber: r.universe_clan_number,
            name: r.name,
            memberCount: r.member_count,
            leaderName: r.leader_name ?? '(no leader)',
            isOwn: r.id === viewerClanId,
        })),
    };
}

export async function serveClanInfo(playerId: number): Promise<CommandResult<'ClanInfo'>> {
    const player = requireOnlinePlayer(playerId);

    const clanId = await getPlayerClanId(playerId);
    if (clanId === null) {
        return { outcome: 'ok', clan: null };
    }
    const [clan, members, maxSize] = await Promise.all([
        getClanById(clanId),
        getClanMembers(clanId),
        getMaxClanSize(player.universeId),
    ]);
    if (!clan) {
        return { outcome: 'ok', clan: null };
    }
    return {
        outcome: 'ok',
        clan: {
            clanId: clan.id,
            clanNumber: clan.universe_clan_number,
            name: clan.name,
            leaderPlayerId: clan.leader_id,
            members: members.map((m) => ({
                playerId: m.id,
                name: m.name,
                isLeader: m.id === clan.leader_id,
            })),
            maxSize,
        },
    };
}

export async function serveClanmateLocations(
    playerId: number,
): Promise<CommandResult<'ClanmateLocations'>> {
    requireOnlinePlayer(playerId);
    const clanId = await getPlayerClanId(playerId);
    if (clanId === null) {
        return commandRefusal('notInClan');
    }
    const rows = await getClanmateLocations(clanId);
    return {
        outcome: 'ok',
        members: rows.map((r) => ({
            playerId: r.id,
            name: r.name,
            sector: r.sector_number,
            fighters: r.fighters,
            shields: r.shields,
            mines: r.mines,
            credits: r.credits,
        })),
    };
}

async function requireSameClan(senderId: number, targetId: number): Promise<number | Refusal> {
    if (senderId === targetId) return commandRefusal('cannotTransferToSelf');
    const row = await getPlayersClanIds(senderId, targetId);
    if (!row || row.a === null || row.b === null || row.a !== row.b) {
        return commandRefusal('notClanMember');
    }
    return row.a;
}

async function getPlayerDisplayName(playerId: number): Promise<string> {
    return (await getPlayerName(playerId)) ?? 'Player';
}

type TransferAbort = Abort<Refusal>;

/** Moves credits; resolves to the quantity delivered. */
async function transferCredits(
    senderId: number,
    targetId: number,
    quantity: number,
    client: PoolClient,
    abort: TransferAbort,
): Promise<number> {
    const senderCredits = (await getCreditsForUpdate(senderId, client)) ?? 0;
    if (senderCredits < quantity) {
        throw abort(commandRefusal('insufficientCredits', { have: senderCredits }));
    }
    await deductCredits(senderId, quantity, client);
    await addCredits(targetId, quantity, client);
    return quantity;
}

/** The sender always loses the full quantity; overflow past the target's capacity is discarded. */
async function transferDronesOrShields(
    field: 'drones' | 'shields',
    senderId: number,
    targetId: number,
    quantity: number,
    client: PoolClient,
    abort: TransferAbort,
): Promise<number> {
    const senderRow = await getShipCounterForUpdate(senderId, field, client);
    if (!senderRow) throw abort(commandRefusal('noShip'));
    if (senderRow.current < quantity) {
        throw abort(
            commandRefusal(field === 'drones' ? 'notEnoughDrones' : 'insufficientShields', {
                have: senderRow.current,
            }),
        );
    }

    const targetRow = await getShipCounterWithMaxForUpdate(targetId, field, client);
    if (!targetRow) throw abort(commandRefusal('targetHasNoShip'));
    const room = Math.max(0, targetRow.max - targetRow.current);
    const deliveredQty = Math.min(quantity, room);

    await adjustShipCounter(senderRow.ship_id, field, -quantity, client);
    if (deliveredQty > 0) {
        await adjustShipCounter(targetRow.ship_id, field, deliveredQty, client);
    }
    return deliveredQty;
}

async function transferMines(
    senderId: number,
    targetId: number,
    quantity: number,
    mineType: 'proximity' | 'seeker',
    client: PoolClient,
    abort: TransferAbort,
): Promise<number> {
    const hwName = mineType === 'proximity' ? 'proximity_mine' : 'seeker_mine';
    const hwId = (await getHardwareItemByName(hwName, client))?.id;
    if (!hwId) throw new Error('Mine hardware not configured.');

    const senderRow = await getShipHardwareCapacityForUpdate(senderId, hwId, client);
    if (!senderRow || senderRow.current_qty < quantity) {
        throw abort(
            commandRefusal('insufficientMines', {
                have: senderRow?.current_qty ?? 0,
                mineType,
            }),
        );
    }

    const targetRow = await getShipHardwareCapacityForUpdate(targetId, hwId, client);
    if (!targetRow) throw abort(commandRefusal('targetHasNoShip'));
    const room = Math.max(0, targetRow.max_qty - targetRow.current_qty);
    const deliveredQty = Math.min(quantity, room);

    await decrementShipHardwareQuantity(senderRow.ship_id, hwId, quantity, client);
    if (deliveredQty > 0) {
        await upsertShipHardwareQuantity(targetRow.ship_id, hwId, deliveredQty, client);
    }
    return deliveredQty;
}

export async function serveClanTransfer(
    senderId: number,
    data: CommandRequest<'ClanTransfer'>,
): Promise<CommandResult<'ClanTransfer'>> {
    const { kind, targetPlayerId, quantity } = data;
    // The request schema guarantees a mineType for mine transfers.
    const mineType = data.mineType ?? 'proximity';
    const clanId = await requireSameClan(senderId, targetPlayerId);
    if (typeof clanId !== 'number') return clanId;

    return mutateAndReply(
        async (client, abort) => {
            if (kind === 'credits') {
                return transferCredits(senderId, targetPlayerId, quantity, client, abort);
            }
            if (kind === 'mines') {
                return transferMines(senderId, targetPlayerId, quantity, mineType, client, abort);
            }
            return transferDronesOrShields(kind, senderId, targetPlayerId, quantity, client, abort);
        },
        async (delivered) => {
            const senderName = await getPlayerDisplayName(senderId);
            const targetName = await getPlayerDisplayName(targetPlayerId);
            const kindLabel =
                kind === 'mines'
                    ? mineType === 'seeker'
                        ? 'Limpet mines'
                        : 'Proximity mines'
                    : kind;
            const memoBody =
                `Received ${delivered} ${kindLabel} from ${senderName}.` +
                (kind !== 'credits' && delivered < quantity
                    ? ` (${quantity - delivered} discarded — at capacity.)`
                    : '');

            const { notifyAndMail } = await import('../services/notify.js');
            await notifyAndMail({
                recipientId: targetPlayerId,
                sender: { kind: 'player', playerId: senderId, displayName: senderName },
                kind: `transfer_${kind}`,
                body: memoBody,
            });

            return { outcome: 'ok', kind, targetPlayerId, targetName, quantity, delivered };
        },
    );
}

export async function serveClanMemo(
    senderId: number,
    data: CommandRequest<'ClanMemo'>,
): Promise<CommandResult<'ClanMemo'>> {
    const { body } = data;
    requireOnlinePlayer(senderId);
    const clanId = await getPlayerClanId(senderId);
    if (clanId === null) {
        return commandRefusal('notInClan');
    }
    const trimmed = body.trim();

    const members = await getClanMembers(clanId);
    const recipients = members.filter((m) => m.id !== senderId);
    const senderName = recipients.length > 0 ? await getPlayerDisplayName(senderId) : '';
    for (const m of recipients) {
        await insertMemo(m.id, senderId, clanId, 'memo', trimmed);
        if (onlinePlayers[m.id]) {
            sendEnvelope(m.id, {
                type: Events.ClanMemoReceived.name,
                senderName,
            });
        }
    }

    return { outcome: 'ok', recipientCount: recipients.length };
}

export async function serveClanSetPassword(
    playerId: number,
    data: CommandRequest<'ClanSetPassword'>,
): Promise<CommandResult<'ClanSetPassword'>> {
    const { newPassword } = data;
    const clanId = await getPlayerClanId(playerId);
    if (clanId === null) {
        return commandRefusal('notInClan');
    }
    const clan = await getClanById(clanId);
    if (!clan) {
        return commandRefusal('clanNotFound');
    }
    if (clan.leader_id !== playerId) {
        return commandRefusal('notClanLeader');
    }
    await setClanPasswordHash(clanId, hashPassword(newPassword));
    return { outcome: 'ok' };
}

export async function serveClanDropMember(
    leaderPlayerId: number,
    data: CommandRequest<'ClanDropMember'>,
): Promise<CommandResult<'ClanDropMember'>> {
    const { targetPlayerId } = data;
    const player = requireOnlinePlayer(leaderPlayerId);
    if (leaderPlayerId === targetPlayerId) {
        return commandRefusal('cannotDropSelf');
    }
    const clanId = await getPlayerClanId(leaderPlayerId);
    if (clanId === null) {
        return commandRefusal('notInClan');
    }
    const clan = await getClanById(clanId);
    if (!clan || clan.leader_id !== leaderPlayerId) {
        return commandRefusal('notClanLeader');
    }
    const targetClanId = await getPlayerClanId(targetPlayerId);
    if (targetClanId !== clanId) {
        return commandRefusal('notClanMember');
    }

    const leaderName = await getPlayerDisplayName(leaderPlayerId);
    const targetName = await getPlayerDisplayName(targetPlayerId);

    await withTransaction(async (client) => {
        await setPlayerClanId(targetPlayerId, null, client);
        await recordGameEvent(
            player.universeId,
            {
                kind: 'player_kicked_from_clan',
                player: { playerId: targetPlayerId, name: targetName },
                kickedBy: { playerId: leaderPlayerId, name: leaderName },
                clan: clanRefOf(clan),
            },
            client,
        );
    });

    await insertMemo(
        targetPlayerId,
        leaderPlayerId,
        clanId,
        'dropped',
        `You have been dropped from ${clan.name} by ${leaderName}.`,
    );
    const online = onlinePlayers[targetPlayerId];
    if (online) {
        sendEnvelope(targetPlayerId, {
            type: Events.ClanMembershipChanged.name,
            clanId: null,
            reason: 'dropped',
        });
        sendEnvelope(targetPlayerId, {
            type: Events.MailReceived.name,
            memos: [
                {
                    id: 0,
                    senderName: leaderName,
                    kind: 'dropped',
                    body: `You have been dropped from ${clan.name} by ${leaderName}.`,
                    createdAt: new Date().toISOString(),
                },
            ],
        });
    }

    return { outcome: 'ok', droppedPlayerId: targetPlayerId, droppedName: targetName };
}

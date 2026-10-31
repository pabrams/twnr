import { ServerTag, type GameEvent, type GameEventClanRef } from '@twnr/shared';
import type { CommandRequest } from '@twnr/shared';
import { withTransaction } from '../db/index.js';

import { sendEnvelope } from '../state/messaging.js';
import { onlinePlayers } from '../state/players.js';
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
import {
    type CommandError,
    type CommandResult,
    commandError,
    abort,
    isCommandError,
    runMutation,
} from './command.js';

function isValidClanName(name: string): boolean {
    const trimmed = name.trim();
    return trimmed.length >= 2 && trimmed.length <= 32;
}

function isValidPassword(password: string): boolean {
    return password.length >= 4 && password.length <= 64;
}

function clanRefOf(clan: Pick<ClanRow, 'id' | 'universe_clan_number' | 'name'>): GameEventClanRef {
    return { clanId: clan.id, clanNumber: clan.universe_clan_number, name: clan.name };
}

export async function serveClanCreate(
    playerId: number,
    data: CommandRequest<'ClanCreate'>,
): Promise<CommandResult<'ClanCreate'>> {
    const { name, password } = data;
    const player = onlinePlayers[playerId];
    if (!player) return;

    if (!isValidClanName(name)) {
        return commandError('Clan name must be 2-32 characters.');
    }
    if (!isValidPassword(password)) {
        return commandError('Clan password must be 4-64 characters.');
    }

    const trimmedName = name.trim();
    const existingClanId = await getPlayerClanId(playerId);
    if (existingClanId !== null) {
        return commandError('You are already in a clan. Leave first.');
    }

    const existing = await getClanByNameInUniverse(trimmedName, player.universeId);
    if (existing) {
        return commandError('A clan with that name already exists in this universe.');
    }

    const passwordHash = hashPassword(password);

    return runMutation(
        'clan create',
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
            clanId: created.id,
            clanNumber: created.universeClanNumber,
            name: trimmedName,
        }),
        'Failed to create clan.',
    );
}

export async function serveClanJoin(
    playerId: number,
    data: CommandRequest<'ClanJoin'>,
): Promise<CommandResult<'ClanJoin'>> {
    const { name, password } = data;
    const player = onlinePlayers[playerId];
    if (!player) return;

    const existingClanId = await getPlayerClanId(playerId);
    if (existingClanId !== null) {
        return commandError('You are already in a clan. Leave first.');
    }

    const clan = await getClanByNameInUniverse(name.trim(), player.universeId);
    if (!clan) {
        return commandError('No clan with that name in this universe.');
    }
    if (!verifyPassword(password, clan.password_hash)) {
        return commandError('Incorrect clan password.');
    }

    const [memberCount, maxSize] = await Promise.all([
        getClanMemberCount(clan.id),
        getMaxClanSize(player.universeId),
    ]);
    if (memberCount >= maxSize) {
        return commandError(`Clan is full (max ${maxSize} members).`);
    }

    return runMutation(
        'clan join',
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
            clanId: clan.id,
            clanNumber: clan.universe_clan_number,
            name: clan.name,
        }),
        'Failed to join clan.',
    );
}

export async function serveClanLeave(
    playerId: number,
    data: CommandRequest<'ClanLeave'>,
): Promise<CommandResult<'ClanLeave'>> {
    const successorPlayerId = data.successorPlayerId;
    const confirmDissolve = data.confirmDissolve === true;
    const player = onlinePlayers[playerId];
    if (!player) return;

    const clanId = await getPlayerClanId(playerId);
    if (clanId === null) {
        return commandError('You are not in a clan.');
    }

    const clan = await getClanById(clanId);
    if (!clan) {
        return commandError('Clan not found.');
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
            return commandError(
                'Leaving as the last member dissolves the clan. Confirm dissolution to proceed.',
            );
        }
        return runMutation(
            'clan dissolve',
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
            'Failed to dissolve clan.',
        );
        return;
    }

    if (await isPlayerOnClanShip(playerId, clanId)) {
        return commandError(
            'You are piloting a clan ship. Transport to a personal ship before leaving the clan.',
        );
    }

    const isLeader = clan.leader_id === playerId;

    if (isLeader) {
        if (successorPlayerId === undefined) {
            return commandError('Leader must designate a successor before leaving.');
        }
        const members = await getClanMembers(clanId);
        const successor = members.find((m) => m.id === successorPlayerId && m.id !== playerId);
        if (!successor) {
            return commandError('Successor is not a member of this clan.');
        }
        return runMutation(
            'clan leader handoff',
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
            'Failed to hand off leadership.',
        );
        return;
    }

    return runMutation(
        'clan leave',
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
        'Failed to leave clan.',
    );
}

export async function serveClanList(playerId: number): Promise<CommandResult<'ClanList'>> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    const rows = await listClansInUniverse(player.universeId);
    const viewerClanId = await getPlayerClanId(playerId);
    return {
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
    const player = onlinePlayers[playerId];
    if (!player) return;

    const clanId = await getPlayerClanId(playerId);
    if (clanId === null) {
        return { clan: null };
        return;
    }
    const [clan, members, maxSize] = await Promise.all([
        getClanById(clanId),
        getClanMembers(clanId),
        getMaxClanSize(player.universeId),
    ]);
    if (!clan) {
        return { clan: null };
        return;
    }
    return {
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
    const player = onlinePlayers[playerId];
    if (!player) return;
    const clanId = await getPlayerClanId(playerId);
    if (clanId === null) {
        return commandError('You are not in a clan.');
    }
    const rows = await getClanmateLocations(clanId);
    return {
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

async function requireSameClan(senderId: number, targetId: number): Promise<number | CommandError> {
    if (senderId === targetId) return commandError('Cannot transfer to yourself.');
    const row = await getPlayersClanIds(senderId, targetId);
    if (!row || row.a === null || row.b === null || row.a !== row.b) {
        return commandError('Target is not a member of your clan.');
    }
    return row.a;
}

async function getPlayerDisplayName(playerId: number): Promise<string> {
    return (await getPlayerName(playerId)) ?? 'Player';
}

/** Resolves to the quantity actually delivered. */
async function transferCredits(
    senderId: number,
    targetId: number,
    quantity: number,
): Promise<number | CommandError> {
    const clanId = await requireSameClan(senderId, targetId);
    if (isCommandError(clanId)) return clanId;
    if (!Number.isInteger(quantity) || quantity <= 0) {
        return commandError('Invalid credit quantity.');
    }

    return runMutation(
        'clan transfer credits',
        async (client) => {
            const senderCredits = (await getCreditsForUpdate(senderId, client)) ?? 0;
            if (senderCredits < quantity) {
                throw abort(commandError(`Insufficient credits (have ${senderCredits}).`));
            }
            await deductCredits(senderId, quantity, client);
            await addCredits(targetId, quantity, client);
            return quantity;
        },
        (delivered) => delivered,
    );
}

async function transferDronesOrShields(
    field: 'drones' | 'shields',
    senderId: number,
    targetId: number,
    quantity: number,
): Promise<number | CommandError> {
    const clanId = await requireSameClan(senderId, targetId);
    if (isCommandError(clanId)) return clanId;
    if (!Number.isInteger(quantity) || quantity <= 0) {
        return commandError(`Invalid ${field} quantity.`);
    }

    return runMutation(
        `clan transfer ${field}`,
        async (client) => {
            const senderRow = await getShipCounterForUpdate(senderId, field, client);
            if (!senderRow) throw abort(commandError('You have no ship.'));
            if (senderRow.current < quantity) {
                throw abort(commandError(`Insufficient ${field} (have ${senderRow.current}).`));
            }

            const targetRow = await getShipCounterWithMaxForUpdate(targetId, field, client);
            if (!targetRow) throw abort(commandError('Target has no ship.'));
            const room = Math.max(0, targetRow.max - targetRow.current);
            const deliveredQty = Math.min(quantity, room);

            await adjustShipCounter(senderRow.ship_id, field, -quantity, client);
            if (deliveredQty > 0) {
                await adjustShipCounter(targetRow.ship_id, field, deliveredQty, client);
            }
            return deliveredQty;
        },
        (delivered) => delivered,
    );
}

async function transferMines(
    senderId: number,
    targetId: number,
    quantity: number,
    mineType: 'proximity' | 'seeker',
): Promise<number | CommandError> {
    const clanId = await requireSameClan(senderId, targetId);
    if (isCommandError(clanId)) return clanId;
    if (!Number.isInteger(quantity) || quantity <= 0) {
        return commandError('Invalid mine quantity.');
    }
    const hwName = mineType === 'proximity' ? 'proximity_mine' : 'seeker_mine';

    return runMutation(
        'clan transfer mines',
        async (client) => {
            const hwId = (await getHardwareItemByName(hwName, client))?.id;
            if (!hwId) throw abort(commandError('Mine hardware not configured.'));

            const senderRow = await getShipHardwareCapacityForUpdate(senderId, hwId, client);
            if (!senderRow || senderRow.current_qty < quantity) {
                throw abort(
                    commandError(
                        `Insufficient ${mineType} mines (have ${senderRow?.current_qty ?? 0}).`,
                    ),
                );
            }

            const targetRow = await getShipHardwareCapacityForUpdate(targetId, hwId, client);
            if (!targetRow) throw abort(commandError('Target has no ship.'));
            const room = Math.max(0, targetRow.max_qty - targetRow.current_qty);
            const deliveredQty = Math.min(quantity, room);

            // Sender always loses the full quantity; overflow past target capacity is discarded.
            await decrementShipHardwareQuantity(senderRow.ship_id, hwId, quantity, client);
            if (deliveredQty > 0) {
                await upsertShipHardwareQuantity(targetRow.ship_id, hwId, deliveredQty, client);
            }
            return deliveredQty;
        },
        (delivered) => delivered,
    );
}

export async function serveClanTransfer(
    senderId: number,
    data: CommandRequest<'ClanTransfer'>,
): Promise<CommandResult<'ClanTransfer'>> {
    const { kind, targetPlayerId, quantity, mineType } = data;
    let delivered: number | CommandError;
    if (kind === 'credits') {
        delivered = await transferCredits(senderId, targetPlayerId, quantity);
    } else if (kind === 'drones' || kind === 'shields') {
        delivered = await transferDronesOrShields(kind, senderId, targetPlayerId, quantity);
    } else if (kind === 'mines') {
        if (mineType !== 'proximity' && mineType !== 'seeker') {
            return commandError('Invalid mine type.');
        }
        delivered = await transferMines(senderId, targetPlayerId, quantity, mineType);
    } else {
        return commandError('Invalid transfer kind.');
    }
    if (isCommandError(delivered)) return delivered;

    const senderName = await getPlayerDisplayName(senderId);
    const targetName = await getPlayerDisplayName(targetPlayerId);
    const kindLabel =
        kind === 'mines'
            ? mineType === 'seeker'
                ? 'Limpet mines'
                : 'Proximity mines'
            : kind === 'drones'
              ? 'drones'
              : kind === 'shields'
                ? 'shields'
                : 'credits';
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

    return { kind, targetPlayerId, targetName, quantity, delivered };
}

export async function serveClanMemo(
    senderId: number,
    data: CommandRequest<'ClanMemo'>,
): Promise<CommandResult<'ClanMemo'>> {
    const { body } = data;
    const player = onlinePlayers[senderId];
    if (!player) return;
    const clanId = await getPlayerClanId(senderId);
    if (clanId === null) {
        return commandError('You are not in a clan.');
    }
    const trimmed = body.trim();
    if (trimmed.length === 0 || trimmed.length > 2000) {
        return commandError('Memo must be 1-2000 characters.');
    }

    const members = await getClanMembers(clanId);
    const recipients = members.filter((m) => m.id !== senderId);
    const senderName = recipients.length > 0 ? await getPlayerDisplayName(senderId) : '';
    for (const m of recipients) {
        await insertMemo(m.id, senderId, clanId, 'memo', trimmed);
        if (onlinePlayers[m.id]) {
            sendEnvelope(m.id, {
                type: ServerTag.ClanMemoNotification,
                senderName,
            });
        }
    }

    return { recipientCount: recipients.length };
}

export async function serveClanSetPassword(
    playerId: number,
    data: CommandRequest<'ClanSetPassword'>,
): Promise<CommandResult<'ClanSetPassword'>> {
    const { newPassword } = data;
    if (!isValidPassword(newPassword)) {
        return commandError('Password must be 4-64 characters.');
    }
    const clanId = await getPlayerClanId(playerId);
    if (clanId === null) {
        return commandError('You are not in a clan.');
    }
    const clan = await getClanById(clanId);
    if (!clan) {
        return commandError('Clan not found.');
    }
    if (clan.leader_id !== playerId) {
        return commandError('Only the clan leader can change the password.');
    }
    await setClanPasswordHash(clanId, hashPassword(newPassword));
    return {};
}

export async function serveClanDropMember(
    leaderPlayerId: number,
    data: CommandRequest<'ClanDropMember'>,
): Promise<CommandResult<'ClanDropMember'>> {
    const { targetPlayerId } = data;
    const player = onlinePlayers[leaderPlayerId];
    if (!player) return;
    if (leaderPlayerId === targetPlayerId) {
        return commandError('Use Leave to remove yourself.');
    }
    const clanId = await getPlayerClanId(leaderPlayerId);
    if (clanId === null) {
        return commandError('You are not in a clan.');
    }
    const clan = await getClanById(clanId);
    if (!clan || clan.leader_id !== leaderPlayerId) {
        return commandError('Only the clan leader can drop members.');
    }
    const targetClanId = await getPlayerClanId(targetPlayerId);
    if (targetClanId !== clanId) {
        return commandError('Target is not a member of your clan.');
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
            type: ServerTag.ClanMembershipChanged,
            clanId: null,
            reason: 'dropped',
        });
        sendEnvelope(targetPlayerId, {
            type: ServerTag.MemoDelivery,
            reason: 'incoming' as const,
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

    return { droppedPlayerId: targetPlayerId, droppedName: targetName };
}

import { ServerMsgType } from '@twnr/shared';
import { pool, withTransaction } from '../db/index.js';
import { sendEnvelope, sendError } from '../state/messaging.js';
import { players } from '../state/players.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import {
    insertClan,
    getClanById,
    getClanByNameInUniverse,
    listClansInUniverse,
    getClanMembers,
    getClanMemberCount,
    getMaxClanSize,
    setPlayerClanId,
    setClanLeader,
    deleteClan,
    dissolveClanAssets,
    isPlayerOnClanShip,
} from '../db/queries/clan.js';

/** SELECT a player's clan_id (or null). Lightweight ad-hoc query — clan ops
 *  are rare enough that we don't bother caching this in the in-memory player. */
async function getPlayerClanId(playerId: number): Promise<number | null> {
    const res = await pool.query<{ clan_id: number | null }>(
        'SELECT clan_id FROM players WHERE id = $1',
        [playerId],
    );
    return res.rows[0]?.clan_id ?? null;
}

function isValidClanName(name: string): boolean {
    const trimmed = name.trim();
    return trimmed.length >= 2 && trimmed.length <= 32;
}

function isValidPassword(password: string): boolean {
    return password.length >= 4 && password.length <= 64;
}

export async function handleClanCreate(
    playerId: number,
    name: string,
    password: string,
): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (!isValidClanName(name)) {
        sendError(playerId, 'Clan name must be 2-32 characters.');
        return;
    }
    if (!isValidPassword(password)) {
        sendError(playerId, 'Clan password must be 4-64 characters.');
        return;
    }

    const trimmedName = name.trim();
    const existingClanId = await getPlayerClanId(playerId);
    if (existingClanId !== null) {
        sendError(playerId, 'You are already in a clan. Leave first.');
        return;
    }

    const existing = await getClanByNameInUniverse(trimmedName, player.universeId);
    if (existing) {
        sendError(playerId, 'A clan with that name already exists in this universe.');
        return;
    }

    const passwordHash = hashPassword(password);

    try {
        const created = await withTransaction(async (client) => {
            const inserted = await insertClan(
                player.universeId,
                trimmedName,
                passwordHash,
                playerId,
                client,
            );
            await setPlayerClanId(playerId, inserted.id, client);
            return inserted;
        });
        if (!created) {
            sendError(playerId, 'Failed to create clan.');
            return;
        }
        sendEnvelope(playerId, {
            type: ServerMsgType.ClanCreateResult,
            clanId: created.id,
            clanNumber: created.universeClanNumber,
            name: trimmedName,
        });
    } catch (err) {
        console.error('clan create error', err);
        sendError(playerId, 'Failed to create clan.');
    }
}

export async function handleClanJoin(
    playerId: number,
    name: string,
    password: string,
): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const existingClanId = await getPlayerClanId(playerId);
    if (existingClanId !== null) {
        sendError(playerId, 'You are already in a clan. Leave first.');
        return;
    }

    const clan = await getClanByNameInUniverse(name.trim(), player.universeId);
    if (!clan) {
        sendError(playerId, 'No clan with that name in this universe.');
        return;
    }
    if (!verifyPassword(password, clan.password_hash)) {
        sendError(playerId, 'Incorrect clan password.');
        return;
    }

    const [memberCount, maxSize] = await Promise.all([
        getClanMemberCount(clan.id),
        getMaxClanSize(player.universeId),
    ]);
    if (memberCount >= maxSize) {
        sendError(playerId, `Clan is full (max ${maxSize} members).`);
        return;
    }

    await setPlayerClanId(playerId, clan.id);
    sendEnvelope(playerId, {
        type: ServerMsgType.ClanJoinResult,
        clanId: clan.id,
        clanNumber: clan.universe_clan_number,
        name: clan.name,
    });
}

export async function handleClanLeave(
    playerId: number,
    successorPlayerId: number | undefined,
    confirmDissolve: boolean,
): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const clanId = await getPlayerClanId(playerId);
    if (clanId === null) {
        sendError(playerId, 'You are not in a clan.');
        return;
    }

    const clan = await getClanById(clanId);
    if (!clan) {
        sendError(playerId, 'Clan not found.');
        return;
    }

    const memberCount = await getClanMemberCount(clanId);
    const isLastMember = memberCount <= 1;

    // Last member: dissolution path. Caller must confirm because it
    // wipes clan-owned assets.
    if (isLastMember) {
        if (!confirmDissolve) {
            sendError(
                playerId,
                'Leaving as the last member dissolves the clan. Confirm dissolution to proceed.',
            );
            return;
        }
        try {
            const result = await withTransaction(async (client) => {
                const stats = await dissolveClanAssets(
                    clanId,
                    playerId,
                    player.sectorId,
                    client,
                );
                await setPlayerClanId(playerId, null, client);
                await deleteClan(clanId, client);
                return stats;
            });
            if (!result) {
                sendError(playerId, 'Failed to dissolve clan.');
                return;
            }
            sendEnvelope(playerId, {
                type: ServerMsgType.ClanLeaveResult,
                outcome: 'dissolved',
                convertedToPersonal: result.convertedToPersonal,
                convertedToRogue: result.convertedToRogue,
            });
        } catch (err) {
            console.error('clan dissolve error', err);
            sendError(playerId, 'Failed to dissolve clan.');
        }
        return;
    }

    // Non-last member: block leave if currently piloting a clan ship.
    if (await isPlayerOnClanShip(playerId, clanId)) {
        sendError(
            playerId,
            'You are piloting a clan ship. Transport to a personal ship before leaving the clan.',
        );
        return;
    }

    const isLeader = clan.leader_id === playerId;

    // Leader leaving with other members: need a valid successor.
    if (isLeader) {
        if (successorPlayerId === undefined) {
            sendError(playerId, 'Leader must designate a successor before leaving.');
            return;
        }
        const members = await getClanMembers(clanId);
        const successor = members.find(
            (m) => m.id === successorPlayerId && m.id !== playerId,
        );
        if (!successor) {
            sendError(playerId, 'Successor is not a member of this clan.');
            return;
        }
        try {
            await withTransaction(async (client) => {
                await setClanLeader(clanId, successor.id, client);
                await setPlayerClanId(playerId, null, client);
            });
        } catch (err) {
            console.error('clan leader handoff error', err);
            sendError(playerId, 'Failed to hand off leadership.');
            return;
        }
        sendEnvelope(playerId, {
            type: ServerMsgType.ClanLeaveResult,
            outcome: 'left',
            convertedToPersonal: 0,
            convertedToRogue: 0,
        });
        return;
    }

    // Regular member leave.
    await setPlayerClanId(playerId, null);
    sendEnvelope(playerId, {
        type: ServerMsgType.ClanLeaveResult,
        outcome: 'left',
        convertedToPersonal: 0,
        convertedToRogue: 0,
    });
}

export async function handleClanList(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const rows = await listClansInUniverse(player.universeId);
    sendEnvelope(playerId, {
        type: ServerMsgType.ClanListResult,
        clans: rows.map((r) => ({
            clanId: r.id,
            clanNumber: r.universe_clan_number,
            name: r.name,
            memberCount: r.member_count,
            leaderName: r.leader_name ?? '(no leader)',
        })),
    });
}

export async function handleClanInfo(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const clanId = await getPlayerClanId(playerId);
    if (clanId === null) {
        sendEnvelope(playerId, { type: ServerMsgType.ClanInfoResult, clan: null });
        return;
    }
    const [clan, members, maxSize] = await Promise.all([
        getClanById(clanId),
        getClanMembers(clanId),
        getMaxClanSize(player.universeId),
    ]);
    if (!clan) {
        sendEnvelope(playerId, { type: ServerMsgType.ClanInfoResult, clan: null });
        return;
    }
    sendEnvelope(playerId, {
        type: ServerMsgType.ClanInfoResult,
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
    });
}

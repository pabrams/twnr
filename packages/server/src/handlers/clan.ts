import { ServerTag } from '@twnr/shared';
import type {
    ClanCreateCommand,
    ClanJoinCommand,
    ClanLeaveCommand,
    ClanTransferCommand,
    ClanMemoCommand,
    ClanSetPasswordCommand,
    ClanDropMemberCommand,
} from '@twnr/shared';
import { pool, withTransaction, AbortTransaction } from '../db/index.js';
import { runMutation } from './run-mutation.js';
import { sendEnvelope, sendError } from '../state/messaging.js';
import { players } from '../state/players.js';
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
} from '../db/queries/clan.js';
import { insertMemo } from '../db/queries/message.js';

function isValidClanName(name: string): boolean {
    const trimmed = name.trim();
    return trimmed.length >= 2 && trimmed.length <= 32;
}

function isValidPassword(password: string): boolean {
    return password.length >= 4 && password.length <= 64;
}

export async function serveClanCreate(playerId: number, data: ClanCreateCommand): Promise<void> {
    const { name, password } = data;
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

    await runMutation(
        playerId,
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
            return inserted;
        },
        (created) =>
            sendEnvelope(playerId, {
                type: ServerTag.ClanCreateResult,
                clanId: created.id,
                clanNumber: created.universeClanNumber,
                name: trimmedName,
            }),
        'Failed to create clan.',
    );
}

export async function serveClanJoin(playerId: number, data: ClanJoinCommand): Promise<void> {
    const { name, password } = data;
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
        type: ServerTag.ClanJoinResult,
        clanId: clan.id,
        clanNumber: clan.universe_clan_number,
        name: clan.name,
    });
}

export async function serveClanLeave(playerId: number, data: ClanLeaveCommand): Promise<void> {
    const successorPlayerId = data.successorPlayerId;
    const confirmDissolve = data.confirmDissolve === true;
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
        await runMutation(
            playerId,
            'clan dissolve',
            async (client) => {
                const stats = await dissolveClanAssets(clanId, playerId, player.sectorId, client);
                await setPlayerClanId(playerId, null, client);
                await deleteClan(clanId, client);
                return stats;
            },
            (result) =>
                sendEnvelope(playerId, {
                    type: ServerTag.ClanLeaveResult,
                    outcome: 'dissolved',
                    convertedToPersonal: result.convertedToPersonal,
                    convertedToRogue: result.convertedToRogue,
                }),
            'Failed to dissolve clan.',
        );
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
        const successor = members.find((m) => m.id === successorPlayerId && m.id !== playerId);
        if (!successor) {
            sendError(playerId, 'Successor is not a member of this clan.');
            return;
        }
        await runMutation(
            playerId,
            'clan leader handoff',
            async (client) => {
                await setClanLeader(clanId, successor.id, client);
                await setPlayerClanId(playerId, null, client);
                return true;
            },
            () =>
                sendEnvelope(playerId, {
                    type: ServerTag.ClanLeaveResult,
                    outcome: 'left',
                    convertedToPersonal: 0,
                    convertedToRogue: 0,
                }),
            'Failed to hand off leadership.',
        );
        return;
    }

    // Regular member leave.
    await setPlayerClanId(playerId, null);
    sendEnvelope(playerId, {
        type: ServerTag.ClanLeaveResult,
        outcome: 'left',
        convertedToPersonal: 0,
        convertedToRogue: 0,
    });
}

export async function serveClanList(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const rows = await listClansInUniverse(player.universeId);
    const viewerClanId = await getPlayerClanId(playerId);
    sendEnvelope(playerId, {
        type: ServerTag.ClanListResult,
        viewerClanId,
        clans: rows.map((r) => ({
            clanId: r.id,
            clanNumber: r.universe_clan_number,
            name: r.name,
            memberCount: r.member_count,
            leaderName: r.leader_name ?? '(no leader)',
            isOwn: r.id === viewerClanId,
        })),
    });
}

export async function serveClanInfo(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const clanId = await getPlayerClanId(playerId);
    if (clanId === null) {
        sendEnvelope(playerId, { type: ServerTag.ClanInfoResult, clan: null });
        return;
    }
    const [clan, members, maxSize] = await Promise.all([
        getClanById(clanId),
        getClanMembers(clanId),
        getMaxClanSize(player.universeId),
    ]);
    if (!clan) {
        sendEnvelope(playerId, { type: ServerTag.ClanInfoResult, clan: null });
        return;
    }
    sendEnvelope(playerId, {
        type: ServerTag.ClanInfoResult,
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

export async function serveClanmateLocations(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;
    const clanId = await getPlayerClanId(playerId);
    if (clanId === null) {
        sendError(playerId, 'You are not in a clan.');
        return;
    }
    const rows = await getClanmateLocations(clanId);
    sendEnvelope(playerId, {
        type: ServerTag.ClanmateLocationsResult,
        members: rows.map((r) => ({
            playerId: r.id,
            name: r.name,
            sector: r.sector_number,
            fighters: r.fighters,
            shields: r.shields,
            mines: r.mines,
            credits: r.credits,
        })),
    });
}

/** Helper: confirm sender & target are both in the same clan (and not the
 *  same player). Returns the clan id on success, sends an error and returns
 *  null on failure. */
async function requireSameClan(senderId: number, targetId: number): Promise<number | null> {
    if (senderId === targetId) {
        sendError(senderId, 'Cannot transfer to yourself.');
        return null;
    }
    const res = await pool.query<{ s: number | null; t: number | null }>(
        `SELECT s.clan_id AS s, t.clan_id AS t
         FROM players s, players t
         WHERE s.id = $1 AND t.id = $2`,
        [senderId, targetId],
    );
    const row = res.rows[0];
    if (!row || row.s === null || row.t === null || row.s !== row.t) {
        sendError(senderId, 'Target is not a member of your clan.');
        return null;
    }
    return row.s;
}

async function getPlayerName(playerId: number): Promise<string> {
    const r = await pool.query<{ name: string }>('SELECT name FROM players WHERE id = $1', [
        playerId,
    ]);
    return r.rows[0]?.name ?? 'Player';
}

async function transferCredits(
    senderId: number,
    targetId: number,
    quantity: number,
): Promise<{ delivered: number }> {
    const clanId = await requireSameClan(senderId, targetId);
    if (clanId === null) return { delivered: 0 };
    if (!Number.isInteger(quantity) || quantity <= 0) {
        sendError(senderId, 'Invalid credit quantity.');
        return { delivered: 0 };
    }

    const delivered = await withTransaction(async (client) => {
        const r = await client.query<{ credits: number }>(
            'SELECT credits FROM players WHERE id = $1 FOR UPDATE',
            [senderId],
        );
        const senderCredits = r.rows[0]?.credits ?? 0;
        if (senderCredits < quantity) {
            sendError(senderId, `Insufficient credits (have ${senderCredits}).`);
            throw new AbortTransaction();
        }
        await client.query('UPDATE players SET credits = credits - $1 WHERE id = $2', [
            quantity,
            senderId,
        ]);
        await client.query('UPDATE players SET credits = credits + $1 WHERE id = $2', [
            quantity,
            targetId,
        ]);
        return quantity;
    });
    return { delivered: delivered ?? 0 };
}

async function transferDronesOrShields(
    field: 'drones' | 'shields',
    senderId: number,
    targetId: number,
    quantity: number,
): Promise<{ delivered: number }> {
    const clanId = await requireSameClan(senderId, targetId);
    if (clanId === null) return { delivered: 0 };
    if (!Number.isInteger(quantity) || quantity <= 0) {
        sendError(senderId, `Invalid ${field} quantity.`);
        return { delivered: 0 };
    }

    const max_col = field === 'drones' ? 'max_drones' : 'max_shields';
    const delivered = await withTransaction(async (client) => {
        const sender = await client.query<{ ship_id: number; v: number }>(
            `SELECT s.id AS ship_id, s.${field} AS v
             FROM players p JOIN ships s ON p.ship_id = s.id
             WHERE p.id = $1 FOR UPDATE`,
            [senderId],
        );
        const senderRow = sender.rows[0];
        if (!senderRow) {
            sendError(senderId, 'You have no ship.');
            throw new AbortTransaction();
        }
        if (senderRow.v < quantity) {
            sendError(senderId, `Insufficient ${field} (have ${senderRow.v}).`);
            throw new AbortTransaction();
        }

        const target = await client.query<{
            ship_id: number;
            v: number;
            max_v: number;
        }>(
            `SELECT s.id AS ship_id, s.${field} AS v, st.${max_col} AS max_v
             FROM players p JOIN ships s ON p.ship_id = s.id
             JOIN universe_ship_types st ON st.universe_id = s.universe_id AND st.slug = s.ship_type_slug
             WHERE p.id = $1 FOR UPDATE`,
            [targetId],
        );
        const targetRow = target.rows[0];
        if (!targetRow) {
            sendError(senderId, 'Target has no ship.');
            throw new AbortTransaction();
        }
        const room = Math.max(0, targetRow.max_v - targetRow.v);
        const deliveredQty = Math.min(quantity, room);

        await client.query(`UPDATE ships SET ${field} = ${field} - $1 WHERE id = $2`, [
            quantity,
            senderRow.ship_id,
        ]);
        if (deliveredQty > 0) {
            await client.query(`UPDATE ships SET ${field} = ${field} + $1 WHERE id = $2`, [
                deliveredQty,
                targetRow.ship_id,
            ]);
        }
        return deliveredQty;
    });
    return { delivered: delivered ?? 0 };
}

async function transferMines(
    senderId: number,
    targetId: number,
    quantity: number,
    mineType: 'proximity' | 'seeker',
): Promise<{ delivered: number }> {
    const clanId = await requireSameClan(senderId, targetId);
    if (clanId === null) return { delivered: 0 };
    if (!Number.isInteger(quantity) || quantity <= 0) {
        sendError(senderId, 'Invalid mine quantity.');
        return { delivered: 0 };
    }
    const hwName = mineType === 'proximity' ? 'proximity_mine' : 'seeker_mine';

    const delivered = await withTransaction(async (client) => {
        const hwRow = await client.query<{ id: number }>(
            'SELECT id FROM hardware_item WHERE name = $1',
            [hwName],
        );
        const hwId = hwRow.rows[0]?.id;
        if (!hwId) {
            sendError(senderId, 'Mine hardware not configured.');
            throw new AbortTransaction();
        }

        // Sender ship + current mine count.
        const sender = await client.query<{ ship_id: number; qty: number }>(
            `SELECT s.id AS ship_id,
                    COALESCE((SELECT quantity FROM ship_hardware sh
                              WHERE sh.ship_id = s.id AND sh.hardware_item_id = $2), 0) AS qty
             FROM players p JOIN ships s ON p.ship_id = s.id
             WHERE p.id = $1 FOR UPDATE`,
            [senderId, hwId],
        );
        const senderRow = sender.rows[0];
        if (!senderRow || senderRow.qty < quantity) {
            sendError(senderId, `Insufficient ${mineType} mines (have ${senderRow?.qty ?? 0}).`);
            throw new AbortTransaction();
        }

        // Target ship + max capacity + current mine count.
        const target = await client.query<{
            ship_id: number;
            ship_type_slug: string;
            max_qty: number;
            qty: number;
        }>(
            `SELECT s.id AS ship_id, s.ship_type_slug,
                    COALESCE(sth.max_quantity, 0) AS max_qty,
                    COALESCE((SELECT quantity FROM ship_hardware sh
                              WHERE sh.ship_id = s.id AND sh.hardware_item_id = $2), 0) AS qty
             FROM players p JOIN ships s ON p.ship_id = s.id
             LEFT JOIN universe_ship_type_hardware sth
                ON sth.universe_id = s.universe_id
                AND sth.ship_type_slug = s.ship_type_slug
                AND sth.hardware_item_id = $2
             WHERE p.id = $1 FOR UPDATE`,
            [targetId, hwId],
        );
        const targetRow = target.rows[0];
        if (!targetRow) {
            sendError(senderId, 'Target has no ship.');
            throw new AbortTransaction();
        }
        const room = Math.max(0, targetRow.max_qty - targetRow.qty);
        const deliveredQty = Math.min(quantity, room);

        // Decrement sender (always full quantity).
        await client.query(
            `UPDATE ship_hardware SET quantity = quantity - $1
             WHERE ship_id = $2 AND hardware_item_id = $3`,
            [quantity, senderRow.ship_id, hwId],
        );
        // Increment target (upsert).
        if (deliveredQty > 0) {
            await client.query(
                `INSERT INTO ship_hardware (ship_id, hardware_item_id, quantity)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (ship_id, hardware_item_id)
                 DO UPDATE SET quantity = ship_hardware.quantity + $3`,
                [targetRow.ship_id, hwId, deliveredQty],
            );
        }
        return deliveredQty;
    });
    return { delivered: delivered ?? 0 };
}

export async function serveClanTransfer(
    senderId: number,
    data: ClanTransferCommand,
): Promise<void> {
    const { kind, targetPlayerId, quantity, mineType } = data;
    let result: { delivered: number };
    if (kind === 'credits') {
        result = await transferCredits(senderId, targetPlayerId, quantity);
    } else if (kind === 'drones' || kind === 'shields') {
        result = await transferDronesOrShields(kind, senderId, targetPlayerId, quantity);
    } else if (kind === 'mines') {
        if (mineType !== 'proximity' && mineType !== 'seeker') {
            sendError(senderId, 'Invalid mine type.');
            return;
        }
        result = await transferMines(senderId, targetPlayerId, quantity, mineType);
    } else {
        sendError(senderId, 'Invalid transfer kind.');
        return;
    }

    if (result.delivered === 0 && kind !== 'credits') {
        // Already sent error inside the transfer helper if zero delivered.
        // (credits has no clamp; zero only happens on error path.)
        return;
    }

    const senderName = await getPlayerName(senderId);
    const targetName = await getPlayerName(targetPlayerId);
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
        `Received ${result.delivered} ${kindLabel} from ${senderName}.` +
        (kind !== 'credits' && result.delivered < quantity
            ? ` (${quantity - result.delivered} discarded — at capacity.)`
            : '');

    const { notifyAndMail } = await import('../services/notify.js');
    await notifyAndMail({
        recipientId: targetPlayerId,
        sender: { kind: 'player', playerId: senderId, displayName: senderName },
        kind: `transfer_${kind}`,
        body: memoBody,
    });

    sendEnvelope(senderId, {
        type: ServerTag.ClanTransferResult,
        kind,
        targetPlayerId,
        targetName,
        quantity,
        delivered: result.delivered,
    });
}

export async function serveClanMemo(senderId: number, data: ClanMemoCommand): Promise<void> {
    const { body } = data;
    const player = players[senderId];
    if (!player) return;
    const clanId = await getPlayerClanId(senderId);
    if (clanId === null) {
        sendError(senderId, 'You are not in a clan.');
        return;
    }
    const trimmed = body.trim();
    if (trimmed.length === 0 || trimmed.length > 2000) {
        sendError(senderId, 'Memo must be 1-2000 characters.');
        return;
    }

    const members = await getClanMembers(clanId);
    const recipients = members.filter((m) => m.id !== senderId);
    const senderName = recipients.length > 0 ? await getPlayerName(senderId) : '';
    for (const m of recipients) {
        await insertMemo(m.id, senderId, clanId, 'memo', trimmed);
        // Online clan members get only a notification — the body lives in
        // their inbox, surfaced when they next run the M command.
        if (players[m.id]) {
            sendEnvelope(m.id, {
                type: ServerTag.ClanMemoNotification,
                senderName,
            });
        }
    }

    sendEnvelope(senderId, {
        type: ServerTag.ClanMemoResult,
        recipientCount: recipients.length,
    });
}

export async function serveClanSetPassword(
    playerId: number,
    data: ClanSetPasswordCommand,
): Promise<void> {
    const { newPassword } = data;
    if (!isValidPassword(newPassword)) {
        sendError(playerId, 'Password must be 4-64 characters.');
        return;
    }
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
    if (clan.leader_id !== playerId) {
        sendError(playerId, 'Only the clan leader can change the password.');
        return;
    }
    await setClanPasswordHash(clanId, hashPassword(newPassword));
    sendEnvelope(playerId, { type: ServerTag.ClanSetPasswordResult });
}

export async function serveClanDropMember(
    leaderPlayerId: number,
    data: ClanDropMemberCommand,
): Promise<void> {
    const { targetPlayerId } = data;
    const player = players[leaderPlayerId];
    if (!player) return;
    if (leaderPlayerId === targetPlayerId) {
        sendError(leaderPlayerId, 'Use Leave to remove yourself.');
        return;
    }
    const clanId = await getPlayerClanId(leaderPlayerId);
    if (clanId === null) {
        sendError(leaderPlayerId, 'You are not in a clan.');
        return;
    }
    const clan = await getClanById(clanId);
    if (!clan || clan.leader_id !== leaderPlayerId) {
        sendError(leaderPlayerId, 'Only the clan leader can drop members.');
        return;
    }
    const targetClanId = await getPlayerClanId(targetPlayerId);
    if (targetClanId !== clanId) {
        sendError(leaderPlayerId, 'Target is not a member of your clan.');
        return;
    }

    await setPlayerClanId(targetPlayerId, null);

    const leaderName = await getPlayerName(leaderPlayerId);
    const targetName = await getPlayerName(targetPlayerId);
    await insertMemo(
        targetPlayerId,
        leaderPlayerId,
        clanId,
        'dropped',
        `You have been dropped from ${clan.name} by ${leaderName}.`,
    );
    const online = players[targetPlayerId];
    if (online) {
        // Tell the target their clan state changed so the client's cached
        // `ctx.player.clanId` gets cleared
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

    sendEnvelope(leaderPlayerId, {
        type: ServerTag.ClanDropMemberResult,
        droppedPlayerId: targetPlayerId,
        droppedName: targetName,
    });
}

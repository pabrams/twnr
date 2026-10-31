// Clans: membership, transfers and memos.

import { z } from 'zod';

import { defineCommand, defineEvent } from './define.js';

import { Int, Num, Bool, Str, IntOrNull, MineTypeSchema } from './common.js';

export const ClanListEntrySchema = z.object({
    clanId: Int,
    clanNumber: Int,
    name: Str,
    memberCount: Num,
    leaderName: Str,
    isOwn: Bool,
});

export type ClanListEntry = z.infer<typeof ClanListEntrySchema>;

export const ClanMemberEntrySchema = z.object({
    playerId: Int,
    name: Str,
    isLeader: Bool,
});

export type ClanMemberEntry = z.infer<typeof ClanMemberEntrySchema>;

export const ClanmateLocationEntrySchema = z.object({
    playerId: Int,
    name: Str,
    sector: IntOrNull,
    fighters: Num,
    shields: Num,
    mines: Num,
    credits: Num,
});

export type ClanmateLocationEntry = z.infer<typeof ClanmateLocationEntrySchema>;

export const ClanTransferKindSchema = z.enum(['credits', 'drones', 'shields', 'mines']);

export const ClanMembershipChanged = defineEvent('clanMembershipChanged', {
    clanId: IntOrNull,
    reason: z.enum(['dropped', 'dissolved', 'other']),
});

export const ClanMemoNotification = defineEvent('clanMemoNotification', {
    senderName: Str,
});

export const ClanCreate = defineCommand('clanCreate', {
    request: {
        name: z.string(),
        password: z.string(),
    },
    reply: {
        clanId: Int,
        clanNumber: Int,
        name: Str,
    },
});

export const ClanJoin = defineCommand('clanJoin', {
    request: {
        name: z.string(),
        password: z.string(),
    },
    reply: {
        clanId: Int,
        clanNumber: Int,
        name: Str,
    },
});

export const ClanLeave = defineCommand('clanLeave', {
    request: {
        successorPlayerId: Int.optional(),
        confirmDissolve: z.boolean().optional(),
    },
    reply: {
        outcome: z.enum(['left', 'dissolved']),
        convertedToPersonal: Num,
        convertedToRogue: Num,
    },
});

export const ClanList = defineCommand('clanList', {
    request: {},
    reply: {
        viewerClanId: IntOrNull,
        clans: z.array(ClanListEntrySchema),
    },
});

export const ClanInfo = defineCommand('clanInfo', {
    request: {},
    reply: {
        clan: z
            .object({
                clanId: Int,
                clanNumber: Int,
                name: Str,
                leaderPlayerId: Int,
                members: z.array(ClanMemberEntrySchema),
                maxSize: Num,
            })
            .nullable(),
    },
});

export const ClanTransfer = defineCommand('clanTransfer', {
    request: {
        kind: ClanTransferKindSchema,
        targetPlayerId: Int,
        quantity: Int,
        mineType: MineTypeSchema.optional(),
    },
    reply: {
        kind: z.enum(['credits', 'drones', 'shields', 'mines']),
        targetPlayerId: Int,
        targetName: Str,
        quantity: Num,
        delivered: Num,
    },
});

export const ClanMemo = defineCommand('clanMemo', {
    request: {
        body: z.string(),
    },
    reply: {
        recipientCount: Num,
    },
});

export const ClanSetPassword = defineCommand('clanSetPassword', {
    request: {
        newPassword: z.string(),
    },
    reply: {},
});

export const ClanDropMember = defineCommand('clanDropMember', {
    request: {
        targetPlayerId: Int,
    },
    reply: {
        droppedPlayerId: Int,
        droppedName: Str,
    },
});

export const ClanmateLocations = defineCommand('clanmateLocations', {
    request: {},
    reply: {
        members: z.array(ClanmateLocationEntrySchema),
    },
});

// Clans: membership, transfers and memos.

import { z } from 'zod';

import { defineCommand, defineEvent, outcomes } from './define.js';

import {
    Int,
    Num,
    Bool,
    Str,
    IntOrNull,
    MineTypeSchema,
    PositiveInt,
    Id,
    MemoBody,
    ClanName,
    ClanPassword,
} from './common.js';

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
        name: ClanName,
        password: ClanPassword,
    },
    reply: {
        clanId: Int,
        clanNumber: Int,
        name: Str,
    },
});

export const ClanJoin = defineCommand('clanJoin', {
    request: {
        name: z.string().trim().min(1),
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
        successorPlayerId: Id.optional(),
        confirmDissolve: z.boolean().optional(),
    },
    reply: outcomes({
        left: {},
        dissolved: {
            convertedToPersonal: Num,
            convertedToRogue: Num,
        },
    }),
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
    request: z
        .object({
            kind: ClanTransferKindSchema,
            targetPlayerId: Id,
            quantity: PositiveInt,
            mineType: MineTypeSchema.optional(),
        })
        .refine((transfer) => transfer.kind !== 'mines' || transfer.mineType !== undefined, {
            message: 'mineType is required when kind is mines',
            path: ['mineType'],
        }),
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
        body: MemoBody,
    },
    reply: {
        recipientCount: Num,
    },
});

export const ClanSetPassword = defineCommand('clanSetPassword', {
    request: {
        newPassword: ClanPassword,
    },
    reply: {},
});

export const ClanDropMember = defineCommand('clanDropMember', {
    request: {
        targetPlayerId: Id,
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

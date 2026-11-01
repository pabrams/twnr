// Mail, hails, notices and the Galactic News.

import { z } from 'zod';
import { GameEventSchema } from '../game-events.js';

import { defineCommand, defineEvent, defineReply, outcomes } from './define.js';

import { Int, Bool, Str, StrOrNull, DateString, Id, HailBody } from './common.js';

export const GalacticNewsEntrySchema = z.object({
    id: Int,
    createdAt: DateString,
    event: GameEventSchema,
});

export type GalacticNewsEntry = z.infer<typeof GalacticNewsEntrySchema>;

export const MemoDelivery = defineEvent('memoDelivery', {
    reason: z.enum(['connect', 'read', 'incoming']),
    memos: z.array(
        z.object({
            id: Int,
            senderName: StrOrNull,
            kind: Str,
            body: Str,
            createdAt: Str,
        }),
    ),
});

export const HailIncoming = defineEvent('hailIncoming', {
    senderName: Str,
    body: Str,
});

export const Notice = defineEvent('notice', {
    senderLabel: StrOrNull,
    body: Str,
});

export const ReadMail = defineCommand('readMail', {
    request: {},
    reply: MemoDelivery,
});

export const CheckMailSinceLastLogout = defineCommand('checkMailSinceLastLogout', {
    request: {},
    reply: MemoDelivery,
});

export const DeleteAllMail = defineCommand('deleteAllMail', {
    request: {},
    reply: null,
});

export const HailResolve = defineCommand('hailResolve', {
    request: {
        name: z.string().trim().min(1),
    },
    reply: outcomes({
        found: {
            recipientPlayerId: Int,
            recipientName: Str,
            online: Bool,
        },
        notFound: {},
        ambiguous: {
            matches: z.array(Str),
        },
        self: {},
    }),
});

export const HailSend = defineCommand('hailSend', {
    request: {
        recipientPlayerId: Id,
        body: HailBody,
    },
    reply: outcomes({
        delivered: {},
        queued: {},
    }),
});

/** `earliestCreatedAt` null when the universe has no galactic news yet. */
export const GalacticNewsRange = defineCommand('galacticNewsRange', {
    request: {},
    reply: {
        earliestCreatedAt: DateString.nullable(),
    },
});

/** One chunk, oldest first; when `hasMore`, request again with `afterId` = last entry id. */
// Reply tag predates the `${command}Result` convention (see protocol step 4).
const GalacticNewsResult = defineReply('galacticNewsResult', {
    entries: z.array(GalacticNewsEntrySchema),
    hasMore: Bool,
});

/** `since` is an ISO timestamp (UTC day boundary). Pass the last received id as `afterId` to fetch the next chunk. */
export const ReadGalacticNews = defineCommand('readGalacticNews', {
    request: {
        since: z.iso.datetime(),
        afterId: Id.optional(),
    },
    reply: GalacticNewsResult,
});

// Mail, hails, notices and the Galactic News.

import { z } from 'zod';
import { GameEventSchema } from '../game-events.js';

import { defineCommand, defineEvent, outcomes } from './define.js';

import { Int, Bool, Str, StrOrNull, DateString, Id, HailBody } from './common.js';

export const GalacticNewsEntrySchema = z.object({
    id: Int,
    createdAt: DateString,
    event: GameEventSchema,
});

export type GalacticNewsEntry = z.infer<typeof GalacticNewsEntrySchema>;

export const MemoSchema = z.object({
    id: Int,
    senderName: StrOrNull,
    kind: Str,
    body: Str,
    createdAt: Str,
});
export type Memo = z.infer<typeof MemoSchema>;

/** Mail that arrived while the player is online. */
export const MailReceived = defineEvent('mailReceived', {
    memos: z.array(MemoSchema),
});

export const HailReceived = defineEvent('hailReceived', {
    senderName: Str,
    body: Str,
});

export const Notice = defineEvent('notice', {
    senderLabel: StrOrNull,
    body: Str,
});

export const ReadMail = defineCommand('readMail', {
    request: {},
    reply: outcomes({
        ok: { memos: z.array(MemoSchema) },
    }),
});

export const CheckMailSinceLastLogout = defineCommand('checkMailSinceLastLogout', {
    request: {},
    reply: outcomes({
        ok: { memos: z.array(MemoSchema) },
    }),
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
    reply: outcomes({
        ok: {
            earliestCreatedAt: DateString.nullable(),
        },
    }),
});

/**
 * `since` is an ISO timestamp (UTC day boundary). Replies one chunk, oldest
 * first; when `hasMore`, request again with `afterId` = last entry id.
 */
export const ReadGalacticNews = defineCommand('readGalacticNews', {
    request: {
        since: z.iso.datetime(),
        afterId: Id.optional(),
    },
    reply: outcomes({
        ok: {
            entries: z.array(GalacticNewsEntrySchema),
            hasMore: Bool,
        },
    }),
});

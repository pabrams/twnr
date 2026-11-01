import {
    Events,
    command,
    type AnyCommandDef,
    type ClientEnvelope,
    type ReplyOf,
    type RequestBody,
    type ServerEnvelope,
} from '@twnr/shared';
import type { GameContext } from '../types.js';

export type IOCtx = Pick<GameContext, 'io' | 'input'>;

export type AcceptedEnvelope = Exclude<ServerEnvelope, { outcome: 'refused' }>;

/**
 * Resolves with the first envelope of one of `types`. Null when that envelope
 * was a refusal or ProtocolError (both already rendered), on connection drop,
 * or on a server menu change.
 */
export async function awaitResponse(ctx: IOCtx, types: string[]): Promise<AcceptedEnvelope | null> {
    const msg = await new Promise<ServerEnvelope | null>((resolve) => {
        ctx.input.pendingResponse = {
            types: new Set([...types, Events.ProtocolError.name]),
            resolve,
        };
    });
    if (msg === null || msg.type === Events.ProtocolError.name) return null;
    if ('outcome' in msg && msg.outcome === 'refused') return null;
    return msg as AcceptedEnvelope;
}

type WithReply = AnyCommandDef & { reply: NonNullable<AnyCommandDef['reply']> };

/**
 * Sends a command and waits for its reply. Null when the reply was a refusal
 * (already rendered), a ProtocolError (already rendered), or the socket dropped.
 */
export async function request<D extends WithReply>(
    ctx: IOCtx,
    def: D,
    body: RequestBody<D>,
): Promise<Exclude<ReplyOf<D>, { outcome: 'refused' }> | null> {
    ctx.io.sendMsg(command(def, body) as ClientEnvelope);
    const reply = await awaitResponse(ctx, [def.reply.name]);
    if (reply === null || reply.type !== def.reply.name) return null;
    return reply as Exclude<ReplyOf<D>, { outcome: 'refused' }>;
}

import { ServerTag, type ClientEnvelope, type ServerEnvelope } from '@twnr/shared';
import type { GameContext } from '../types.js';

export type IOCtx = Pick<GameContext, 'io' | 'input'>;

/** Park until the server sends one of `types` (or the connection drops, which
 *  resolves null). Used directly by flows that accept more than one success
 *  tag; single-reply flows should prefer `request`. */
export function awaitResponse(ctx: IOCtx, types: string[]): Promise<ServerEnvelope | null> {
    return new Promise((resolve) => {
        ctx.input.pendingResponse = { types: new Set(types), resolve };
    });
}

/** Send a command and await its single expected reply (or an Error / dropped
 *  connection). Returns the reply narrowed to `okType`, or null if the server
 *  errored or the socket dropped — callers `if (!reply) return;` and proceed.
 *  For flows that accept more than one success tag, use awaitResponse directly. */
export async function request<K extends ServerEnvelope['type']>(
    ctx: IOCtx,
    command: ClientEnvelope,
    okType: K,
): Promise<Extract<ServerEnvelope, { type: K }> | null> {
    ctx.io.sendMsg(command);
    const reply = await awaitResponse(ctx, [okType, ServerTag.Error]);
    if (reply === null || reply.type !== okType) return null;
    return reply as Extract<ServerEnvelope, { type: K }>;
}

import { ServerTag, type ClientEnvelope, type ServerEnvelope } from '@twnr/shared';
import type { GameContext } from '../types.js';

export type IOCtx = Pick<GameContext, 'io' | 'input'>;

/** Parks until the server sends one of `types`; a dropped connection resolves null.
 *  Single-reply flows should prefer `request`. */
export function awaitResponse(ctx: IOCtx, types: string[]): Promise<ServerEnvelope | null> {
    return new Promise((resolve) => {
        ctx.input.pendingResponse = { types: new Set(types), resolve };
    });
}

/** Returns the reply narrowed to `okType`, or null on server error or socket drop.
 *  Flows that accept more than one success tag use awaitResponse directly. */
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

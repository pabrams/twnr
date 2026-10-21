import { ServerTag, type ClientEnvelope, type ServerEnvelope } from '@twnr/shared';
import type { GameContext } from '../types.js';

export type IOCtx = Pick<GameContext, 'io' | 'input'>;

/** Resolves null on connection drop or server menu change. */
export function awaitResponse(ctx: IOCtx, types: string[]): Promise<ServerEnvelope | null> {
    return new Promise((resolve) => {
        ctx.input.pendingResponse = { types: new Set(types), resolve };
    });
}

/** Null on server Error (already rendered by the error handler) or socket drop. */
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

import type { ServerEnvelope } from '@twnr/shared';
import { ServerTag } from '@twnr/shared';
import type { GameContext } from './types.js';

import { render } from './renderer.js';
import { NOTIFY } from './messages/index.js';
import { getMenuHandler } from './menus/index.js';
import { dispatch } from './handlers/index.js';
import { drainInputQueue } from './input.js';

/** Server messages whose handler should NOT trigger a menu prompt re-render.
 *
 *  Two reasons an envelope belongs here:
 *
 *  1. Panel-only updates that have no terminal output (otherwise the prompt
 *     duplicates on every panel refresh — e.g. minimap zoom/pan).
 *  2. Interim events arriving mid-flow before the concluding result
 *     envelope. Mine events fire during a move *before* MoveResult, while
 *     `ctx.world.currentSector` still points at the previous sector — a
 *     prompt rendered now would show the wrong sector. The MoveResult that
 *     follows is the right paint point.
 */
const PROMPT_SUPPRESSING = new Set<string>([
    ServerTag.NeighborhoodResult,
    ServerTag.ProximityMineHit,
    ServerTag.SeekerMineAttached,
    ServerTag.SeekerMinePickupAlert,
]);

export function setupConnection(
    ws: WebSocket,
    ctx: GameContext,
    onClose: (info: { code: number; reason: string }) => void,
) {
    ws.addEventListener('open', () => {
        ctx.io.term.writeln(render(NOTIFY.connected));
    });

    ws.addEventListener('close', (event) => {
        onClose({ code: event.code, reason: event.reason });
    });

    ws.addEventListener('message', (event) => {
        const msg: ServerEnvelope = JSON.parse(event.data);
        if (ctx.io.debug) {
            const lines = JSON.stringify(msg, null, 2).split('\n');
            ctx.io.term.writeln(`\r\n\x1b[38;5;243m← ${lines[0]}\x1b[0m`);
            for (let i = 1; i < lines.length; i++) {
                ctx.io.term.writeln(`\x1b[38;5;243m  ${lines[i]}\x1b[0m`);
            }
        }

        ctx.input.inFlight = false;
        const handlerResult = dispatch(ctx, msg);

        let resolvedResponse = false;
        if (ctx.input.pendingResponse?.types.has(msg.type)) {
            const r = ctx.input.pendingResponse;
            ctx.input.pendingResponse = null;
            resolvedResponse = true;
            r.resolve(msg);
        }

        const repaint = () => {
            if (
                !ctx.input.inFlight &&
                !ctx.input.pendingResolver &&
                !ctx.input.pendingResponse &&
                !PROMPT_SUPPRESSING.has(msg.type)
            ) {
                getMenuHandler(ctx.world.mode)?.renderPrompt?.(ctx);
            }
        };
        // Single paint per incoming envelope. Three cases:
        //   - A routine consumed the envelope via awaitResponse: that
        //     routine's own finishUp will paint when it completes; we stay
        //     out of the way.
        //   - Handler returned a promise: wait for the whole async chain
        //     to settle, then paint.
        //   - Handler was sync: paint now.
        if (resolvedResponse) {
            // routine owns the paint
        } else if (
            handlerResult &&
            typeof (handlerResult as Promise<unknown>).then === 'function'
        ) {
            void (handlerResult as Promise<unknown>).then(repaint);
        } else {
            repaint();
        }
        drainInputQueue(ctx);
    });
    ws.addEventListener('error', () => {
        ctx.io.term.writeln(render(NOTIFY.connectionError));
    });
}

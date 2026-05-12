import type { ServerResult } from '@twnr/shared';
import { ServerMsgType } from '@twnr/shared';
import type { GameContext } from './types.js';

import { render } from './renderer.js';
import { NOTIFY } from './messages/index.js';
import { getMenuHandler } from './menus/index.js';
import { dispatch } from './handlers/index.js';
import { drainInputQueue } from './input.js';

/** Server messages whose handler updates a side panel only (no terminal
 * output). These should NOT trigger a menu prompt re-render — otherwise
 * the prompt duplicates on every panel refresh (e.g. minimap zoom/pan). */
const PROMPT_SUPPRESSING = new Set<string>([ServerMsgType.NeighborhoodResult]);

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
        const msg: ServerResult = JSON.parse(event.data);
        if (ctx.io.debug) {
            const lines = JSON.stringify(msg, null, 2).split('\n');
            ctx.io.term.writeln(`\r\n\x1b[38;5;243m← ${lines[0]}\x1b[0m`);
            for (let i = 1; i < lines.length; i++) {
                ctx.io.term.writeln(`\x1b[38;5;243m  ${lines[i]}\x1b[0m`);
            }
        }

        ctx.input.inFlight = false;
        const handlerResult = dispatch(ctx, msg);
        // If a routine is awaiting this message via awaitResponse, resolve
        // it after dispatch so the handler runs first (state updates,
        // notifications). The routine then owns the next prompt paint via
        // its own finishUp.
        let resolvedResponse = false;
        if (ctx.input.pendingResponse?.types.has(msg.type)) {
            const r = ctx.input.pendingResponse;
            ctx.input.pendingResponse = null;
            resolvedResponse = true;
            r.resolve(msg);
        }

        // Single render path: paint exactly once after the dispatched work
        // is fully settled. For sync handlers / pure renders, that's right
        // now. For async handlers (e.g. deployDronesInfo asks askNumber +
        // askDeployOwnership then sendMsg) we attach a finishUp to the
        // promise so the prompt only paints after the entire chain has resolved.
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
        if (handlerResult && typeof (handlerResult as Promise<unknown>).then === 'function') {
            // Async handler — wait for its whole chain to complete before
            // checking. Suppress the immediate paint.
            void (handlerResult as Promise<unknown>).then(repaint);
        } else if (!resolvedResponse) {
            // Sync handler that didn't resolve an awaited response. Paint
            // now — when resolvedResponse is true, the awaiting routine's
            // own finishUp will paint instead.
            repaint();
        }
        drainInputQueue(ctx);
    });
    ws.addEventListener('error', () => {
        ctx.io.term.writeln(render(NOTIFY.connectionError));
    });
}

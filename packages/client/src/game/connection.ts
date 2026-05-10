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
        dispatch(ctx, msg);
        // If a routine is awaiting this message via awaitResponse, resolve
        // it after dispatch so the handler runs first (state updates,
        // notifications). Suppress the auto renderPrompt for this
        // envelope — the routine owns what comes next.
        let resolvedResponse = false;
        if (ctx.input.pendingResponse?.types.has(msg.type)) {
            const r = ctx.input.pendingResponse;
            ctx.input.pendingResponse = null;
            resolvedResponse = true;
            r.resolve(msg);
        }
        // Skip the auto-render when:
        //  - the handler chained another roundtrip (`inFlight`)
        //  - the handler opened a sub-prompt (`pendingResolver`) — e.g.
        //    askNumber inside a client routine.
        //  - a routine is awaiting a server response (`pendingResponse`),
        //    or this very envelope just resolved one (`resolvedResponse`).
        //  - the envelope is a pure side-panel update (mini-map zoom/pan).
        if (
            !ctx.input.inFlight &&
            !ctx.input.pendingResolver &&
            !ctx.input.pendingResponse &&
            !resolvedResponse &&
            !PROMPT_SUPPRESSING.has(msg.type)
        ) {
            getMenuHandler(ctx.world.mode)?.renderPrompt?.(ctx);
        }
        drainInputQueue(ctx);
    });
    ws.addEventListener('error', () => {
        ctx.io.term.writeln(render(NOTIFY.connectionError));
    });
}

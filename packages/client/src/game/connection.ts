import type { ServerMessage } from '@twnr/shared';
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
        const msg: ServerMessage = JSON.parse(event.data);
        if (ctx.io.debug) {
            const lines = JSON.stringify(msg, null, 2).split('\n');
            ctx.io.term.writeln(`\r\n\x1b[38;5;243m← ${lines[0]}\x1b[0m`);
            for (let i = 1; i < lines.length; i++) {
                ctx.io.term.writeln(`\x1b[38;5;243m  ${lines[i]}\x1b[0m`);
            }
        }
        // If a routine was awaiting a sub-prompt and the server is moving
        // us to a different menu (interruption: we got attacked, autopilot
        // hop, etc.), cancel the pending input so the routine resolves
        // with null and unwinds cleanly. Don't cancel when the menu is
        // unchanged — pure panel updates and same-menu envelopes shouldn't
        // disturb an in-progress prompt.
        if (msg.menu !== ctx.world.mode) {
            if (ctx.input.pendingResolver) {
                const r = ctx.input.pendingResolver;
                ctx.input.pendingResolver = null;
                r.resolve(null);
            }
            if (ctx.input.pendingResponse) {
                const r = ctx.input.pendingResponse;
                ctx.input.pendingResponse = null;
                r.resolve(null);
            }
        }
        ctx.world.mode = msg.menu;
        // Clear inFlight before dispatch so handlers can re-set it (via sendMsg)
        // when they chain a follow-up roundtrip. After dispatch, renderPrompt
        // only fires if the handler did NOT chain — otherwise we'd flash a
        // prompt for the intermediate state (e.g. autopilot mid-hops).
        ctx.input.inFlight = false;
        if (msg.type !== ServerMsgType.MenuTransition) {
            dispatch(ctx, msg);
        }
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
        //  - the server marked the envelope as a transient step in a
        //    multi-message flow (`suppressPrompt`).
        if (
            !ctx.input.inFlight &&
            !ctx.input.pendingResolver &&
            !ctx.input.pendingResponse &&
            !resolvedResponse &&
            !msg.suppressPrompt &&
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

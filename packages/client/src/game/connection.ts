import type { ServerMessage } from '@twnr/shared';
import { ServerMsgType } from '@twnr/shared';
import type { GameContext } from './types.js';

import { render } from './renderer.js';
import { NOTIFY } from './messages/index.js';
import { getMenuHandler } from './menus/index.js';
import { dispatch } from './handlers/index.js';
import { drainInputQueue } from './input.js';

export function setupConnection(ws: WebSocket, ctx: GameContext, onDisconnect: () => void) {
    ws.addEventListener('open', () => {
        ctx.io.term.writeln(render(NOTIFY.connected));
    });

    ws.addEventListener('close', () => {
        onDisconnect();
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
        ctx.world.mode = msg.menu;
        // Clear inFlight before dispatch so handlers can re-set it (via sendMsg)
        // when they chain a follow-up roundtrip. After dispatch, renderPrompt
        // only fires if the handler did NOT chain — otherwise we'd flash a
        // prompt for the intermediate state (e.g. autopilot mid-hops).
        ctx.input.inFlight = false;
        if (msg.type !== ServerMsgType.MenuTransition) {
            dispatch(ctx, msg);
        }
        if (!ctx.input.inFlight) {
            getMenuHandler(ctx.world.mode)?.renderPrompt?.(ctx);
        }
        drainInputQueue(ctx);
    });
    ws.addEventListener('error', () => {
        ctx.io.term.writeln(render(NOTIFY.connectionError));
    });
}

import type { ServerResult, MenuName } from '@twnr/shared';
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
        const raw = JSON.parse(event.data);
        if (ctx.io.debug) {
            const lines = JSON.stringify(raw, null, 2).split('\n');
            ctx.io.term.writeln(`\r\n\x1b[38;5;243m← ${lines[0]}\x1b[0m`);
            for (let i = 1; i < lines.length; i++) {
                ctx.io.term.writeln(`\x1b[38;5;243m  ${lines[i]}\x1b[0m`);
            }
        }
        if (raw.menu) {
            ctx.world.mode = raw.menu as MenuName;
        }
        // No payload means pure menu transition.
        if (raw.payload === undefined) {
            getMenuHandler(ctx.world.mode)?.renderPrompt?.(ctx);
            ctx.input.inFlight = false;
            drainInputQueue(ctx);
            return;
        }
        const msg: ServerResult = raw.payload;
        dispatch(ctx, msg);
        // After every server message: clear in-flight and drain the burst/script
        // queue. Direct user keystrokes don't go through that queue, so this only
        // affects programmatic input sources.
        ctx.input.inFlight = false;
        drainInputQueue(ctx);
    });
    ws.addEventListener('error', () => {
        ctx.io.term.writeln(render(NOTIFY.connectionError));
    });
}

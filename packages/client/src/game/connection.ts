import type { ServerResult, MenuName } from '@twnr/shared';
import type { GameContext } from './types.js';

import { render } from './renderer.js';
import { NOTIFY } from './messages/index.js';
import { getMenuHandler } from './menus/index.js';
import { dispatch } from './handlers/index.js';
import { drainInputQueue } from './input.js';

export function setupConnection(ws: WebSocket, ctx: GameContext, onDisconnect: () => void) {
    ws.addEventListener('open', () => {
        ctx.term.writeln(render(NOTIFY.connected));
    });

    ws.addEventListener('close', () => {
        onDisconnect();
    });

    ws.addEventListener('message', (event) => {
        const raw = JSON.parse(event.data);
        if (ctx.debug) {
            const lines = JSON.stringify(raw, null, 2).split('\n');
            ctx.term.writeln(`\r\n\x1b[38;5;243m← ${lines[0]}\x1b[0m`);
            for (let i = 1; i < lines.length; i++) {
                ctx.term.writeln(`\x1b[38;5;243m  ${lines[i]}\x1b[0m`);
            }
        }
        if (raw.menu) {
            ctx.mode = raw.menu as MenuName;
        }
        // No payload ⇔ pure menu transition. The envelope's `menu` field
        // (already mirrored into ctx.mode above) is the entire content;
        // the new menu's enter() — if it has one — paints the prompt.
        if (raw.payload === undefined) {
            getMenuHandler(ctx.mode)?.enter?.(ctx);
            ctx.inFlight = false;
            drainInputQueue(ctx);
            return;
        }
        const msg: ServerResult = raw.payload;
        dispatch(ctx, msg);
        // After every server message: clear in-flight and drain the burst/script
        // queue. Direct user keystrokes don't go through the queue, so this only
        // affects programmatic input sources.
        ctx.inFlight = false;
        drainInputQueue(ctx);
    });
    ws.addEventListener('error', () => {
        ctx.term.writeln(render(NOTIFY.connectionError));
    });
}

import type { ServerEnvelope } from '@twnr/shared';
import { ServerEnvelopeSchema, ServerTag } from '@twnr/shared';
import type { GameContext } from './types.js';

import { render } from './renderer.js';
import { NOTIFY } from './messages/index.js';
import { getMenuHandler } from './routines/index.js';
import { dispatch } from './handlers/index.js';
import { drainInputQueue } from './input.js';

/** Envelopes that must not trigger a prompt re-render: panel-only updates with no
 *  terminal output (the prompt would duplicate on every refresh), and interim events
 *  arriving before their concluding result — mine events fire mid-move while
 *  currentSector still points at the previous sector; MoveResult is the paint point. */
const PROMPT_SUPPRESSING = new Set<string>([
    ServerTag.NeighborhoodResult,
    ServerTag.ProximityMineHit,
    ServerTag.SeekerMineAttached,
    ServerTag.SeekerMinePickupAlert,
    ServerTag.StatsSnapshot,
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
        let raw: unknown;
        try {
            raw = JSON.parse(event.data);
        } catch (err) {
            console.error('Invalid JSON from server', err, event.data);
            return;
        }
        const parsed = ServerEnvelopeSchema.safeParse(raw);
        let msg: ServerEnvelope;
        if (parsed.success) {
            msg = parsed.data;
        } else {
            console.error('ServerEnvelope failed schema validation', parsed.error.issues, raw);
            msg = raw as ServerEnvelope;
        }
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

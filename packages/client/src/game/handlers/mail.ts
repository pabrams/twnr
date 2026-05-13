import { ClientTag } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { EVENT } from '../messages/index.js';
import { renderMailEntries } from '../display-mail.js';
import { askConfirm } from '../menus/prompts.js';
import type { Handler } from './index.js';

type MailContext = Pick<GameContext, 'io' | 'input'>;

/**
 * MemoDelivery handler — three modes:
 *   - `connect`: header + entries (or "No messages received."); delete prompt if non-empty.
 *   - `incoming`: render entries inline, no delete prompt (used by clan memos in Phase 1).
 *   - `read`: handled by the read_mail routine via awaitResponse, so this never fires.
 */
export const clanMemoNotification: Handler<'clanMemoNotification', MailContext> = (ctx, msg) => {
    ctx.io.term.writeln(render(EVENT.clanMemoNotification, { name: msg.senderName }));
};

export const hailIncoming: Handler<'hailIncoming', MailContext> = (ctx, msg) => {
    ctx.io.term.writeln(render(EVENT.hailIncomingHeader, { name: msg.senderName }));
    for (const line of msg.body.split(/\r?\n/)) {
        ctx.io.term.writeln(render(EVENT.hailIncomingBody, { line }));
    }
};

export const memoDelivery: Handler<'memoDelivery', MailContext> = async (ctx, msg) => {
    if (msg.reason === 'connect') {
        ctx.io.term.writeln(render(EVENT.mailConnectHeader));
        if (msg.memos.length === 0) {
            ctx.io.term.writeln(render(EVENT.mailNoneReceived));
        } else {
            renderMailEntries(ctx, msg.memos);
            const del = await askConfirm(ctx, render(EVENT.mailDeletePrompt), {
                defaultValue: false,
            });
            if (del) ctx.io.sendMsg({ type: ClientTag.DeleteAllMail });
        }
        // Chain a location-aware re-display via the same path Enter takes,
        // so the player lands on whatever menu their current location maps
        // to (sector / planet / starbase) — with the normal echo.
        ctx.io.submitLineFromMap('');
        return;
    }
    if (msg.reason === 'incoming') {
        renderMailEntries(ctx, msg.memos);
        return;
    }
    // 'read' is consumed by the read_mail routine; reaching here means the
    // routine didn't have its await listener ready, just render.
    renderMailEntries(ctx, msg.memos);
};

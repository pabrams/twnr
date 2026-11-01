import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { EVENT } from '../messages/index.js';
import { renderMailEntries } from '../display-mail.js';
import type { EventHandler } from './index.js';

type MailContext = Pick<GameContext, 'io' | 'input'>;

export const clanMemoReceived: EventHandler<'ClanMemoReceived', MailContext> = (ctx, msg) => {
    ctx.io.term.writeln(render(EVENT.clanMemoNotification, { name: msg.senderName }));
};

export const notice: EventHandler<'Notice', MailContext> = (ctx, msg) => {
    if (msg.senderLabel) {
        ctx.io.term.writeln(render(EVENT.noticeHeader, { name: msg.senderLabel }));
    } else {
        ctx.io.term.writeln('');
    }
    for (const line of msg.body.split(/\r?\n/)) {
        ctx.io.term.writeln(render(EVENT.noticeBodyLine, { line }));
    }
};

export const hailReceived: EventHandler<'HailReceived', MailContext> = (ctx, msg) => {
    ctx.io.term.writeln(render(EVENT.hailIncomingHeader, { name: msg.senderName }));
    for (const line of msg.body.split(/\r?\n/)) {
        ctx.io.term.writeln(render(EVENT.hailIncomingBody, { line }));
    }
};

export const mailReceived: EventHandler<'MailReceived', MailContext> = (ctx, msg) => {
    renderMailEntries(ctx, msg.memos);
};

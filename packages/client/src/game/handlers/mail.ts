import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { EVENT } from '../messages/index.js';
import { renderMailEntries } from '../display-mail.js';
import type { Handler } from './index.js';

type MailContext = Pick<GameContext, 'io' | 'input'>;

export const clanMemoNotification: Handler<'clanMemoNotification', MailContext> = (ctx, msg) => {
    ctx.io.term.writeln(render(EVENT.clanMemoNotification, { name: msg.senderName }));
};

export const notice: Handler<'notice', MailContext> = (ctx, msg) => {
    if (msg.senderLabel) {
        ctx.io.term.writeln(render(EVENT.noticeHeader, { name: msg.senderLabel }));
    } else {
        ctx.io.term.writeln('');
    }
    for (const line of msg.body.split(/\r?\n/)) {
        ctx.io.term.writeln(render(EVENT.noticeBodyLine, { line }));
    }
};

export const hailIncoming: Handler<'hailIncoming', MailContext> = (ctx, msg) => {
    ctx.io.term.writeln(render(EVENT.hailIncomingHeader, { name: msg.senderName }));
    for (const line of msg.body.split(/\r?\n/)) {
        ctx.io.term.writeln(render(EVENT.hailIncomingBody, { line }));
    }
};

/**
 * Only the `incoming` mode actually renders here — used for unprompted
 * in-game pushes (e.g. a clan member being dropped). `connect` and `read`
 * are server responses to client-initiated commands and are consumed by
 * their awaiting routines (connect-flow and read_mail) via `awaitResponse`;
 * the routines own the rendering for those modes.
 */
export const memoDelivery: Handler<'memoDelivery', MailContext> = (ctx, msg) => {
    if (msg.reason === 'incoming') {
        renderMailEntries(ctx, msg.memos);
    }
};

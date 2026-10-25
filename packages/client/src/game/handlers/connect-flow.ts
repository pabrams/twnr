import { ClientTag, ServerTag } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { EVENT } from '../messages/index.js';
import { askConfirm } from '../routines/prompts.js';
import { awaitResponse } from '../routines/io.js';
import { renderMailEntries } from '../display-mail.js';

type ConnectFlowCtx = Pick<GameContext, 'io' | 'input' | 'player'>;

export async function runConnectFlow(ctx: ConnectFlowCtx): Promise<void> {
    await checkConnectMail(ctx);
    ctx.io.submitLineFromMap('');
}

async function checkConnectMail(ctx: ConnectFlowCtx): Promise<void> {
    ctx.io.sendMsg({ type: ClientTag.CheckMailSinceLastLogout });
    const reply = await awaitResponse(ctx, [ServerTag.MemoDelivery, ServerTag.Error]);
    if (reply === null) return;
    if (reply.type !== ServerTag.MemoDelivery) return;
    ctx.io.term.writeln(render(EVENT.mailConnectHeader));
    if (reply.memos.length === 0) {
        ctx.io.term.writeln(render(EVENT.mailNoneReceived));
        return;
    }
    renderMailEntries(ctx, reply.memos);
    const del = await askConfirm(ctx, render(EVENT.mailDeletePrompt), { defaultValue: false });
    if (del) ctx.io.sendMsg({ type: ClientTag.DeleteAllMail });
}

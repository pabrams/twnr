import { Commands, command } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { EVENT, NEWS } from '../messages/index.js';
import { askConfirm } from '../routines/prompts.js';
import { request } from '../routines/io.js';
import { renderMailEntries } from '../display-mail.js';
import { showGalacticNews } from '../routines/news.js';

type ConnectFlowCtx = Pick<GameContext, 'io' | 'input' | 'player'>;

export async function runConnectFlow(ctx: ConnectFlowCtx): Promise<void> {
    await offerTodaysNews(ctx);
    await checkConnectMail(ctx);
    ctx.io.submitLineFromMap('');
}

async function offerTodaysNews(ctx: ConnectFlowCtx): Promise<void> {
    const wantsNews = await askConfirm(ctx, render(NEWS.connectPrompt), { defaultValue: false });
    if (wantsNews) await showGalacticNews(ctx, new Date());
}

async function checkConnectMail(ctx: ConnectFlowCtx): Promise<void> {
    const reply = await request(ctx, Commands.CheckMailSinceLastLogout, {});
    if (reply === null) return;
    ctx.io.term.writeln(render(EVENT.mailConnectHeader));
    if (reply.memos.length === 0) {
        ctx.io.term.writeln(render(EVENT.mailNoneReceived));
        return;
    }
    renderMailEntries(ctx, reply.memos);
    const del = await askConfirm(ctx, render(EVENT.mailDeletePrompt), { defaultValue: false });
    if (del) ctx.io.sendMsg(command(Commands.DeleteAllMail, {}));
}

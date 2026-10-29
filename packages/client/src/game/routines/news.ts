import { ClientTag, ServerTag } from '@twnr/shared';
import { render } from '../renderer.js';
import { NEWS } from '../messages/index.js';
import { buildNewsLines, startOfUtcDay } from '../display-news.js';
import { request, type IOCtx } from './io.js';
import { writePaged } from './pager.js';

export async function showGalacticNews(ctx: IOCtx, from: Date): Promise<void> {
    const since = startOfUtcDay(from);
    const reply = await request(
        ctx,
        { type: ClientTag.ReadGalacticNews, since: since.toISOString() },
        ServerTag.GalacticNewsResult,
    );
    if (!reply) return;
    const lines = buildNewsLines(reply.entries, since, startOfUtcDay(new Date()));
    ctx.io.term.writeln('');
    await writePaged(ctx, lines, {
        pausePrompt: render(NEWS.pausePrompt),
        endPrompt: render(NEWS.endPrompt),
    });
}

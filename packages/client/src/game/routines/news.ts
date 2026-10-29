import { ClientTag, ServerTag } from '@twnr/shared';
import { render } from '../renderer.js';
import { NEWS } from '../messages/index.js';
import { buildNewsLines, startOfLocalDay } from '../display-news.js';
import { request, type IOCtx } from './io.js';
import { writePaged } from './pager.js';

/** Fetches and pages the Galactic News from local midnight of `from` through today. */
export async function showGalacticNews(ctx: IOCtx, from: Date): Promise<void> {
    const since = startOfLocalDay(from);
    const reply = await request(
        ctx,
        { type: ClientTag.ReadGalacticNews, since: since.toISOString() },
        ServerTag.GalacticNewsResult,
    );
    if (!reply) return;
    const lines = buildNewsLines(reply.entries, since, startOfLocalDay(new Date()));
    ctx.io.term.writeln('');
    await writePaged(ctx, lines, render(NEWS.pausePrompt));
}

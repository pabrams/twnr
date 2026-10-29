import { ClientTag, ServerTag, type GalacticNewsEntry } from '@twnr/shared';
import { render } from '../renderer.js';
import { NEWS } from '../messages/index.js';
import { buildNewsLines, startOfUtcDay } from '../display-news.js';
import { request, type IOCtx } from './io.js';
import { writePaged } from './pager.js';

async function fetchAllNews(ctx: IOCtx, since: Date): Promise<GalacticNewsEntry[] | null> {
    const entries: GalacticNewsEntry[] = [];
    let afterId: number | undefined;
    while (true) {
        const reply = await request(
            ctx,
            { type: ClientTag.ReadGalacticNews, since: since.toISOString(), afterId },
            ServerTag.GalacticNewsResult,
        );
        if (!reply) return null;
        entries.push(...reply.entries);
        if (!reply.hasMore || reply.entries.length === 0) return entries;
        afterId = reply.entries[reply.entries.length - 1].id;
    }
}

export async function showGalacticNews(ctx: IOCtx, from: Date): Promise<void> {
    const since = startOfUtcDay(from);
    const entries = await fetchAllNews(ctx, since);
    if (!entries) return;
    const lines = buildNewsLines(entries, since, startOfUtcDay(new Date()));
    ctx.io.term.writeln('');
    await writePaged(ctx, lines, {
        pausePrompt: render(NEWS.pausePrompt),
        endPrompt: render(NEWS.endPrompt),
    });
}

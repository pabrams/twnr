import { askKey, type PromptCtx } from './prompts.js';

const ERASE_LINE = '\r\x1b[2K';

/** Writes lines one screenful at a time, pausing between pages; false if the reader cancelled. */
export async function writePaged(
    ctx: PromptCtx,
    lines: string[],
    pausePrompt: string,
): Promise<boolean> {
    const pageSize = Math.max(1, ctx.io.term.rows - 1);
    for (let i = 0; i < lines.length; i++) {
        if (i > 0 && i % pageSize === 0) {
            const key = await askKey(ctx, pausePrompt);
            ctx.io.term.write(ERASE_LINE);
            if (key === null || key.toLowerCase() === 'c') return false;
        }
        ctx.io.term.writeln(lines[i]);
    }
    return true;
}

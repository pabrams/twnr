import { askKey, type PromptCtx } from './prompts.js';

const ERASE_LINE = '\r\x1b[2K';

async function pause(ctx: PromptCtx, prompt: string): Promise<string | null> {
    const key = await askKey(ctx, prompt);
    ctx.io.term.write(ERASE_LINE);
    return key;
}


export async function writePaged(
    ctx: PromptCtx,
    lines: string[],
    prompts: { pausePrompt: string; endPrompt: string },
): Promise<boolean> {
    const pageSize = Math.max(1, ctx.io.term.rows - 1);
    for (let i = 0; i < lines.length; i++) {
        if (i > 0 && i % pageSize === 0) {
            const key = await pause(ctx, prompts.pausePrompt);
            if (key === null || key.toLowerCase() === 'c') return false;
        }
        ctx.io.term.writeln(lines[i]);
    }
    await pause(ctx, prompts.endPrompt);
    return true;
}

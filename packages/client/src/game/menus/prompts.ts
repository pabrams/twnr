import type { ServerEnvelope } from '@twnr/shared';
import type { GameContext } from '../types.js';

/**
 * Prompts only need the io (terminal) and input (pendingResolver) slots.
 * Narrowing lets handler-side code that holds a Pick<GameContext, ...>
 * pass it in directly without widening to GameContext.
 */
export type PromptCtx = Pick<GameContext, 'io' | 'input'>;

/** Park, line-mode: resolves with the next submitted line on Enter. */
function parkLine(ctx: PromptCtx): Promise<string | null> {
    return new Promise((resolve) => {
        ctx.input.pendingResolver = { mode: 'line', resolve };
    });
}

/** Park, char-mode: resolves with the next keystroke (no Enter required). */
function parkChar(ctx: PromptCtx): Promise<string | null> {
    return new Promise((resolve) => {
        ctx.input.pendingResolver = { mode: 'char', resolve };
    });
}

/** Free-form line. `q` and empty Enter both cancel. */
export async function askLine(ctx: PromptCtx, prompt: string): Promise<string | null> {
    ctx.io.term.write(prompt);
    const line = await parkLine(ctx);
    if (line === null) return null;
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.toLowerCase() === 'q') return null;
    return trimmed;
}

/**
 * Collect a multi-line message, one line at a time, with `linePrompt` shown
 * before each line. Blank line ends the message and returns the joined body
 * (newline-separated). Returns null if the user cancels by pressing Q on an
 * otherwise-empty line at the start (no lines collected yet).
 */
export async function askMultiLine(
    ctx: PromptCtx,
    linePrompt: string,
): Promise<string | null> {
    const lines: string[] = [];
    while (true) {
        ctx.io.term.write(linePrompt);
        const raw = await parkLine(ctx);
        if (raw === null) return lines.length > 0 ? lines.join('\n') : null;
        if (raw === '') return lines.join('\n');
        lines.push(raw);
    }
}

/** Like askLine, but resolves immediately (no Enter required) when the
 *  first keystroke matches one of `instantChars`. Used by menus where a
 *  number (multi-char) and a single-letter shortcut both make sense — e.g.
 *  the transporter "pick a ship #, or I/Q" prompt. */
export async function askLineWithShortcuts(
    ctx: PromptCtx,
    prompt: string,
    instantChars: string[],
): Promise<string | null> {
    const instantLower = new Set(instantChars.map((c) => c.toLowerCase()));
    ctx.io.term.write(prompt);
    // First keystroke: char-mode park. If it's one of the shortcuts, return
    // it immediately. If it's a digit (or any other char), echo it and
    // switch to line mode to assemble the rest of the number.
    const first = await parkChar(ctx);
    if (first === null) return null;
    const firstLower = first.toLowerCase();
    if (firstLower === 'q') return null;
    if (instantLower.has(firstLower)) {
        ctx.io.term.writeln(first);
        return firstLower;
    }
    // Backspace/Enter on the first keystroke — drop or accept as empty.
    if (first === '\r' || first === '\n') return null;
    // Switch to line mode with `first` already in the buffer + echoed.
    ctx.io.term.write(first);
    ctx.input.inputAssembly = first;
    const full = await parkLine(ctx);
    if (full === null) return null;
    const trimmed = full.trim();
    if (trimmed === '' || trimmed.toLowerCase() === 'q') return null;
    return trimmed;
}

export async function askChar(
    ctx: PromptCtx,
    prompt: string,
    allowed: string[],
): Promise<string | null> {
    const allowedLower = allowed.map((k) => k.toLowerCase());
    while (true) {
        ctx.io.term.write(prompt);
        const ch = await parkChar(ctx);
        if (ch === null) return null;
        const lower = ch.toLowerCase();
        if (lower === 'q') return null;
        if (allowedLower.includes(lower)) {
            ctx.io.term.writeln(ch);
            return lower;
        }
        ctx.io.term.writeln('');
        ctx.io.term.writeln(`Invalid choice — try one of: ${allowed.join(', ')}`);
    }
}

export async function askNumber(
    ctx: PromptCtx,
    prompt: string,
    opts?: { min?: number; max?: number; defaultValue?: number },
): Promise<number | null> {
    while (true) {
        ctx.io.term.write(prompt);
        const line = await parkLine(ctx);
        if (line === null) return null;
        const trimmed = line.trim();
        if (trimmed.toLowerCase() === 'q') return null;
        if (trimmed === '') {
            if (opts?.defaultValue !== undefined) return opts.defaultValue;
            return null;
        }
        const n = parseInt(trimmed, 10);
        if (isNaN(n) || !Number.isFinite(n)) {
            ctx.io.term.writeln('Enter a number (Q to cancel).');
            continue;
        }
        if (opts?.min !== undefined && n < opts.min) {
            ctx.io.term.writeln(`Minimum is ${opts.min}.`);
            continue;
        }
        if (opts?.max !== undefined && n > opts.max) {
            ctx.io.term.writeln(`Maximum is ${opts.max}.`);
            continue;
        }
        return n;
    }
}

export function awaitResponse(ctx: PromptCtx, types: string[]): Promise<ServerEnvelope | null> {
    return new Promise((resolve) => {
        ctx.input.pendingResponse = { types: new Set(types), resolve };
    });
}

export async function askDeployOwnership(
    ctx: PromptCtx & { player: { clanId: number | null } },
    promptText: string,
): Promise<'personal' | 'clan' | null> {
    if (ctx.player.clanId === null) return 'personal';
    const ch = await askChar(ctx, promptText, ['p', 'c']);
    if (ch === null) return null;
    return ch === 'c' ? 'clan' : 'personal';
}

export async function askConfirm(
    ctx: PromptCtx,
    prompt: string,
    opts?: { defaultValue?: boolean },
): Promise<boolean | null> {
    while (true) {
        ctx.io.term.write(prompt);
        const ch = await parkChar(ctx);
        if (ch === null) return null;
        const lower = ch.toLowerCase();
        if (lower === 'q') return null;
        if (lower === 'y') {
            ctx.io.term.writeln(ch);
            return true;
        }
        if (lower === 'n') {
            ctx.io.term.writeln(ch);
            return false;
        }
        if (lower === '\r' || lower === '\n') {
            if (opts?.defaultValue !== undefined) {
                ctx.io.term.writeln('');
                return opts.defaultValue;
            }
        }
        ctx.io.term.writeln('');
        ctx.io.term.writeln('Please answer Y or N (Q to cancel).');
    }
}

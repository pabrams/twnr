import type { GameContext } from '../types.js';

/**
 * Sub-prompt helpers for client routines that need to gather more input
 * before sending a message. Routines `await` these to suspend until the
 * user types something. Each helper sets `ctx.input.pendingResolver` so
 * the input pipeline routes the next input to the routine instead of
 * dispatching it through the menu registry.
 *
 * Cancellation semantics:
 *   - `q` cancels every prompt. Empty Enter cancels line-mode prompts
 *     (askLine, askNumber) unless a `defaultValue` is provided.
 *   - A server-driven menu change clears any pending resolver (see
 *     connection.ts) and the awaiting routine sees `null`. Routines
 *     should always check for `null` and return early.
 *   - Only one prompt can be active at a time. Routines must await each
 *     prompt sequentially.
 */

/** Park, line-mode: resolves with the next submitted line on Enter. */
function parkLine(ctx: GameContext): Promise<string | null> {
    return new Promise((resolve) => {
        ctx.input.pendingResolver = { mode: 'line', resolve };
    });
}

/** Park, char-mode: resolves with the next keystroke (no Enter required). */
function parkChar(ctx: GameContext): Promise<string | null> {
    return new Promise((resolve) => {
        ctx.input.pendingResolver = { mode: 'char', resolve };
    });
}

/** Free-form line. `q` and empty Enter both cancel. */
export async function askLine(ctx: GameContext, prompt: string): Promise<string | null> {
    ctx.io.term.write(prompt);
    const line = await parkLine(ctx);
    if (line === null) return null;
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.toLowerCase() === 'q') return null;
    return trimmed;
}

/** Single character from a fixed set. Resolves on the first keystroke
 * (no Enter needed). `q` cancels even if not in `allowed`. Repeats the
 * prompt on invalid input. */
export async function askChar(
    ctx: GameContext,
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

/** Non-negative integer. `q` or empty cancels (or returns `defaultValue`
 * if specified). Re-prompts on invalid input or out-of-range. */
export async function askNumber(
    ctx: GameContext,
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

/** Y/N confirmation. Single-keystroke. `q` cancels (returns `null`).
 * If `defaultValue` is set, Enter on its own returns that value. */
export async function askConfirm(
    ctx: GameContext,
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

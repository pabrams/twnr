import type { Terminal } from '@xterm/xterm';
import type { GameContext, KeystrokeEvent } from './types.js';
import { getMenuHandler } from './menus/index.js';

/**
 * Returns 'single' for immediate single-char commands, 'buffered' for keys
 * that begin or continue a multi-char input, or false to reject.
 */
function isValidKeyForMenu(ctx: GameContext, key: string): 'single' | 'buffered' | false {
    const menu = ctx.menuRegistry.get(ctx.mode);
    if (!menu) return 'single'; // Registry not loaded yet — permissive fallback

    const lower = key.toLowerCase();
    const hasNumberCmd = menu.commands.some((c) => c.keyPattern === '<number>');
    const hasLetterCmd = menu.commands.some((c) => c.keyPattern === '<letter>');

    for (const cmd of menu.commands) {
        const kp = cmd.keyPattern;
        // Exact single-char match (e.g. 'q', 'd', 'p')
        if (kp.length === 1 && kp === lower) return 'single';
    }

    // Number input — digits start/continue buffer
    if (hasNumberCmd && /\d/.test(key)) return 'buffered';
    // Letter selection (ship catalog, planet specs)
    if (hasLetterCmd && /[a-zA-Z]/.test(key)) return 'single';

    return false;
}

/**
 * Layer 1 — process one keystroke. Direct xterm keys go straight through this;
 * the burst/script queue drains via the same path so digit assembly and
 * single-char dispatch behave identically regardless of source.
 */
function processKeystroke(ctx: GameContext, ev: KeystrokeEvent) {
    if (ev.isEnter) {
        ctx.term.writeln('');
        handleInput(ctx, ctx.inputAssembly.trim());
        ctx.inputAssembly = '';
        return;
    }
    if (ev.isBackspace) {
        if (ctx.inputAssembly.length > 0) {
            ctx.inputAssembly = ctx.inputAssembly.slice(0, -1);
            ctx.term.write('\b \b');
        }
        return;
    }
    const validity = isValidKeyForMenu(ctx, ev.key);
    if (validity === false) {
        // Invalid key for current menu — reject silently
        return;
    }
    if (ctx.inputAssembly === '' && validity === 'single') {
        ctx.term.writeln('');
        handleInput(ctx, ev.key.toLowerCase());
    } else {
        ctx.inputAssembly += ev.key;
        ctx.term.write(ev.key);
    }
}

/**
 * Drain after every server envelope. Layer 1 (user-typed during a roundtrip)
 * runs first with swallow-on-invalid — fast typing that's still wrong against
 * the new menu was a user typo, drop it. Layer 2 (burst/script) runs after
 * Layer 1 is empty with park-on-invalid — a programmatic burst stays coherent
 * even if the menu state diverged, and the user unjams via Layer 3's clear.
 * Both stop the moment a dispatch causes another roundtrip (sets inFlight).
 */
export function drainInputQueue(ctx: GameContext) {
    while (!ctx.inFlight && ctx.userInputBuffer.length > 0) {
        const head = ctx.userInputBuffer.shift()!;
        processKeystroke(ctx, head);
    }
    while (!ctx.inFlight && ctx.inputQueue.length > 0) {
        const head = ctx.inputQueue[0];
        const isSpecial = head.isEnter || head.isBackspace;
        if (!isSpecial && isValidKeyForMenu(ctx, head.key) === false) {
            break;
        }
        ctx.inputQueue.shift();
        processKeystroke(ctx, head);
    }
}

export function setupInput(term: Terminal, ctx: GameContext) {
    term.onKey(({ key, domEvent }) => {
        if (key === '~') {
            ctx.setDebug(!ctx.debug);
            return;
        }
        const ev: KeystrokeEvent = {
            key,
            isEnter: domEvent.key === 'Enter',
            isBackspace: domEvent.key === 'Backspace',
        };
        // While a server roundtrip is in flight, queue the user's keystroke at
        // Layer 1 so fast typing isn't dropped by the stale ctx.mode. The drain
        // after the next envelope replays it against the (possibly new) menu.
        if (ctx.inFlight) {
            ctx.userInputBuffer.push(ev);
            return;
        }
        processKeystroke(ctx, ev);
    });

    // Mini-map click injection: route through the same input handler the user
    // reaches with Enter, so map clicks behave exactly like typed commands.
    ctx.submitLineFromMap = (line: string) => {
        const trimmed = line.trim();
        if (trimmed.length > 0) term.writeln(trimmed);
        else term.writeln('');
        handleInput(ctx, trimmed);
    };
}

function handleInput(ctx: GameContext, line: string) {
    // Ignore input during autopilot (but allow when paused for encounters).
    if (ctx.autopilotPath.length > 0 && ctx.autopilotStep > 0 && !ctx.autopilotPaused) return;
    // All menus (including Sector) live in menus/<name>.ts. The dispatcher
    // is now a single registry lookup.
    getMenuHandler(ctx.mode)?.input?.(ctx, line);
}

import type { Terminal } from '@xterm/xterm';
import type { GameContext, KeystrokeEvent } from './types.js';
import { getMenuHandler, getRoutine, showPrompt } from './routines/index.js';

/**
 * Returns 'single' for immediate single-char commands, 'buffered' for keys
 * that begin or continue a multi-char input, or false to reject.
 */
function isValidKeyForMenu(ctx: GameContext, key: string): 'single' | 'buffered' | false {
    const menu = ctx.catalogs.menus.get(ctx.world.mode);
    if (!menu) return 'single';
    if (menu.commands.length === 0) {
        const handler = getMenuHandler(ctx.world.mode);
        if (handler?.acceptsKey) return handler.acceptsKey(key) ? 'single' : false;
        return 'single';
    }

    const lower = key.toLowerCase();
    const hasNumberCmd = menu.commands.some((c) => c.keyPattern === '<number>');

    for (const cmd of menu.commands) {
        const kp = cmd.keyPattern;
        // Exact single-char match (e.g. 'q', 'd', 'p')
        if (kp.length === 1 && kp === lower) return 'single';
    }

    // Number input — digits start/continue buffer
    if (hasNumberCmd && /\d/.test(key)) return 'buffered';

    return false;
}

function processKeystroke(ctx: GameContext, ev: KeystrokeEvent) {
    // Char-mode sub-prompt (askChar/askConfirm): resolve on the next
    // keystroke without waiting for Enter or doing menu validation.
    if (ctx.input.pendingResolver?.mode === 'char') {
        if (ev.isEnter) {
            const r = ctx.input.pendingResolver;
            ctx.input.pendingResolver = null;
            r.resolve('\r');
            return;
        }
        if (ev.isBackspace) return;
        const r = ctx.input.pendingResolver;
        ctx.input.pendingResolver = null;
        r.resolve(ev.key);
        return;
    }
    if (ev.isEnter) {
        ctx.io.term.writeln('');
        onInput(ctx, ctx.input.inputAssembly.trim());
        ctx.input.inputAssembly = '';
        return;
    }
    if (ev.isBackspace) {
        if (ctx.input.inputAssembly.length > 0) {
            ctx.input.inputAssembly = ctx.input.inputAssembly.slice(0, -1);
            ctx.io.term.write('\b \b');
        }
        return;
    }
    // Line-mode sub-prompt (askLine/askNumber): assemble characters
    // until Enter; menu-key validation does not apply.
    if (ctx.input.pendingResolver?.mode === 'line') {
        ctx.input.inputAssembly += ev.key;
        ctx.io.term.write(ev.key);
        return;
    }
    const validity = isValidKeyForMenu(ctx, ev.key);
    if (validity === false) {
        // Invalid key for current menu — reject silently
        return;
    }
    if (ctx.input.inputAssembly === '' && validity === 'single') {
        ctx.io.term.writeln('');
        onInput(ctx, ev.key.toLowerCase());
    } else {
        ctx.input.inputAssembly += ev.key;
        ctx.io.term.write(ev.key);
    }
}

export function drainInputQueue(ctx: GameContext) {
    while (!ctx.input.inFlight && ctx.input.userInputBuffer.length > 0) {
        const head = ctx.input.userInputBuffer.shift()!;
        processKeystroke(ctx, head);
    }
    while (!ctx.input.inFlight && ctx.input.inputQueue.length > 0) {
        const head = ctx.input.inputQueue[0];
        const isSpecial = head.isEnter || head.isBackspace;
        if (!isSpecial && isValidKeyForMenu(ctx, head.key) === false) {
            break;
        }
        ctx.input.inputQueue.shift();
        processKeystroke(ctx, head);
    }
}

export function setupInput(term: Terminal, ctx: GameContext) {
    term.onKey(({ key, domEvent }) => {
        if (key === '~') {
            ctx.io.setDebug(!ctx.io.debug);
            return;
        }
        if (ctx.connection.disconnected) {
            if (domEvent.key === 'Enter' && !ctx.player.isGuest) {
                ctx.connection.reconnect();
            } else if (domEvent.key === 'Escape') {
                ctx.connection.leave();
            }
            return;
        }
        const ev: KeystrokeEvent = {
            key,
            isEnter: domEvent.key === 'Enter',
            isBackspace: domEvent.key === 'Backspace',
        };
        // While a server roundtrip is in flight, queue the user's keystroke at
        // so fast typing isn't dropped by the stale ctx.world.mode.
        if (ctx.input.inFlight) {
            ctx.input.userInputBuffer.push(ev);
            return;
        }
        processKeystroke(ctx, ev);
    });

    // Mini-map click injection: route through the same input handler the user
    // reaches with Enter, so map clicks behave exactly like typed commands.
    ctx.io.submitLineFromMap = (line: string) => {
        const trimmed = line.trim();
        if (trimmed.length > 0) term.writeln(trimmed);
        else term.writeln('');
        onInput(ctx, trimmed);
    };
}

function onInput(ctx: GameContext, line: string) {
    // Ignore input during autopilot (but allow when paused for encounters).
    if (ctx.autopilot.path.length > 0 && ctx.autopilot.step > 0 && !ctx.autopilot.paused) return;
    // Line-mode sub-prompts (askLine/askNumber) resolve here on Enter.
    // Char-mode prompts resolve in processKeystroke and never reach this
    // point. The routine/handler waiting on this ask owns the next paint;
    // its finishUp re-renders the menu prompt once the full chain settles.
    if (ctx.input.pendingResolver?.mode === 'line') {
        const r = ctx.input.pendingResolver;
        ctx.input.pendingResolver = null;
        r.resolve(line);
        return;
    }
    // All menus dispatch through the registry → routine registry. Empty
    // Enter falls through to dispatchByRegistry's `<enter>` keyPattern
    // lookup (or to a no-op for menus that don't bind it).
    const result = dispatchByRegistry(ctx, line);

    // Auto re-render the prompt after every fully client-side action. If
    // the handler/routine triggered a server roundtrip (`inFlight`) or
    // opened a sub-prompt (`pendingResolver`), skip — the framework's
    // post-envelope auto-render or the sub-prompt itself will paint next.

    const finishUp = () => {
        if (!ctx.input.inFlight && !ctx.input.pendingResolver) {
            showPrompt(ctx);
        }
    };
    if (result && typeof (result as Promise<unknown>).then === 'function') {
        void (result as Promise<unknown>).then(finishUp);
    } else {
        finishUp();
    }
}

/**
 * Generic menu dispatcher driven by the cached menu registry. Looks up the
 * (currentMenu, line) pair in `ctx.catalogs.menus`, finds the command name,
 * and invokes the registered routine.
 */
function dispatchByRegistry(ctx: GameContext, line: string): void | Promise<void> {
    const menu = ctx.catalogs.menus.get(ctx.world.mode);
    if (!menu) return;
    const lower = line.toLowerCase();
    let cmd = menu.commands.find((c) => c.keyPattern === lower);
    if (!cmd && line === '') {
        // Empty Enter: pick up the menu's `<enter>` row if it has one
        // (e.g. sector → display_sector triggers a server roundtrip for
        // fresh data). With no row, the framework's auto-prompt-render
        // (in onInput) repaints the prompt — so just fall through.
        cmd = menu.commands.find((c) => c.keyPattern === '<enter>');
        if (!cmd) return;
    }
    if (!cmd && /^\d+$/.test(line)) {
        cmd = menu.commands.find((c) => c.keyPattern === '<number>');
    }
    if (!cmd) return;
    const routine = getRoutine(ctx.world.mode, cmd.command);
    if (!routine) {
        console.warn(
            `No client routine registered for command "${cmd.command}" (menu "${ctx.world.mode}", key "${line}")`,
        );
        return;
    }
    return routine(ctx, line) as void | Promise<void>;
}

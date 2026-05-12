import type { Terminal } from '@xterm/xterm';
import type { GameContext, KeystrokeEvent } from './types.js';
import { getMenuHandler, getRoutine, showPrompt } from './menus/index.js';

/**
 * Returns 'single' for immediate single-char commands, 'buffered' for keys
 * that begin or continue a multi-char input, or false to reject.
 */
function isValidKeyForMenu(ctx: GameContext, key: string): 'single' | 'buffered' | false {
    const menu = ctx.catalogs.menus.get(ctx.world.mode);
    if (!menu) return 'single'; // Registry not loaded yet — permissive fallback
    // Client-driven menu: no menu_command rows means the keys are picked
    // by the client itself (hardware store, ship picker, etc.). If the
    // menu's handler declares `acceptsKey`, use it to filter; otherwise
    // fall back to fully permissive.
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

/**
 * Layer 1 — process one keystroke. Direct xterm keys go straight through this;
 * the burst/script queue drains via the same path so digit assembly and
 * single-char dispatch behave identically regardless of source.
 *
 * Sub-prompt resolvers (askChar/askConfirm/askLine/askNumber) resolve the
 * pending Promise here and stop. They do NOT trigger a prompt re-render —
 * the routine/handler that initiated the ask owns what comes next, and the
 * single render at the end of its full async chain (finishUp) paints the
 * menu prompt after everything's settled.
 */
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
        handleInput(ctx, ctx.input.inputAssembly.trim());
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
        handleInput(ctx, ev.key.toLowerCase());
    } else {
        ctx.input.inputAssembly += ev.key;
        ctx.io.term.write(ev.key);
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
        // While the WS is closed: Enter reconnects, Esc returns to universe
        // select. All other keys are ignored so stale input doesn't queue up.
        // Guest accounts are deleted server-side on WS close, so reconnect is
        // suppressed — Esc is the only way out.
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
        // Layer 1 so fast typing isn't dropped by the stale ctx.world.mode. The drain
        // after the next envelope replays it against the (possibly new) menu.
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
        handleInput(ctx, trimmed);
    };
}

function handleInput(ctx: GameContext, line: string) {
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
    // Per-file `input` handler runs first if registered — including for
    // empty Enter, since some menus (qty prompts) interpret empty as
    // "accept default" rather than "re-render". Menus that have migrated
    // to the routine registry omit `input` entirely and fall through to
    // dispatchByRegistry, whose empty-Enter path picks up the `<enter>`
    // row if one exists.
    const handler = getMenuHandler(ctx.world.mode);
    const result = handler?.input ? handler.input(ctx, line) : dispatchByRegistry(ctx, line);

    // Auto re-render the prompt after every fully client-side action. If
    // the handler/routine triggered a server roundtrip (`inFlight`) or
    // opened a sub-prompt (`pendingResolver`), skip — the framework's
    // post-envelope auto-render or the sub-prompt itself will paint next.
    // Async routines are awaited so the check runs after they actually
    // complete (incl. after their final ask* resolves).
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
 * and invokes the registered routine. Used by menus that have migrated off
 * the per-file `input` switch. Unknown keys are dropped silently — same
 * behavior as the old per-file switches' missing `default` cases.
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
        // (in handleInput) repaints the prompt — so just fall through.
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

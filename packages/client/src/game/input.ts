import type { Terminal } from '@xterm/xterm';
import type { GameContext, KeystrokeEvent } from './types.js';
import { getMenuHandler, getRoutine, showPrompt } from './routines/index.js';

/** 'single' = immediate single-char command, 'buffered' = begins/continues multi-char input, false = reject. */
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
        if (kp.length === 1 && kp === lower) return 'single';
    }

    if (hasNumberCmd && /\d/.test(key)) return 'buffered';

    return false;
}

function processKeystroke(ctx: GameContext, ev: KeystrokeEvent) {
    // Char-mode sub-prompt (askChar/askConfirm): resolves on the next keystroke, no Enter, no menu validation.
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
    // Line-mode sub-prompt (askLine/askNumber): assemble until Enter; menu-key validation does not apply.
    if (ctx.input.pendingResolver?.mode === 'line') {
        ctx.input.inputAssembly += ev.key;
        ctx.io.term.write(ev.key);
        return;
    }
    const validity = isValidKeyForMenu(ctx, ev.key);
    if (validity === false) return;
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
        // Typing dismisses the minimap floating menu — intent switched from clicking.
        ctx.minimap.handle?.closeMenu();
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
        // Queue keystrokes while a roundtrip is in flight so fast typing isn't dropped by the stale ctx.world.mode.
        if (ctx.input.inFlight) {
            ctx.input.userInputBuffer.push(ev);
            return;
        }
        processKeystroke(ctx, ev);
    });

    // Minimap clicks route through the same input handler as Enter, so they behave exactly like typed commands.
    ctx.io.submitLineFromMap = (line: string) => {
        const trimmed = line.trim();
        if (trimmed.length > 0) term.writeln(trimmed);
        else term.writeln('');
        onInput(ctx, trimmed);
    };
    // Minimap menu buttons go through processKeystroke like a real key event, so
    // they work for char-mode sub-prompts and single-key menu commands alike.
    ctx.io.submitKeyFromMap = (key: string) => {
        const ev: KeystrokeEvent = { key, isEnter: false, isBackspace: false };
        if (ctx.input.inFlight) {
            ctx.input.userInputBuffer.push(ev);
            return;
        }
        processKeystroke(ctx, ev);
    };
}

function onInput(ctx: GameContext, line: string) {
    // Ignore input during autopilot (but allow when paused for encounters).
    if (ctx.autopilot.path.length > 0 && ctx.autopilot.step > 0 && !ctx.autopilot.paused) return;
    // Line-mode sub-prompts resolve here on Enter (char-mode resolves in
    // processKeystroke); the routine awaiting the ask owns the next paint.
    if (ctx.input.pendingResolver?.mode === 'line') {
        const r = ctx.input.pendingResolver;
        ctx.input.pendingResolver = null;
        r.resolve(line);
        return;
    }
    const result = dispatchByRegistry(ctx, line);

    // Re-render the prompt after a fully client-side action; a roundtrip
    // (inFlight) or open sub-prompt (pendingResolver) paints next instead.
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

function dispatchByRegistry(ctx: GameContext, line: string): void | Promise<void> {
    const menu = ctx.catalogs.menus.get(ctx.world.mode);
    if (!menu) return;
    const lower = line.toLowerCase();
    let cmd = menu.commands.find((c) => c.keyPattern === lower);
    if (!cmd && line === '') {
        // Empty Enter uses the menu's `<enter>` row; without one, onInput's auto-prompt-render repaints.
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

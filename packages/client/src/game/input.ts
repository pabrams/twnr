import type { Terminal } from '@xterm/xterm';
import { ClientMsgType } from '@twnr/shared';
import type { GameContext } from './display.js';
import { showPrompt, showPortMenu, showHelp, showShipInfo, showDockedMenu } from './display.js';

export function setupInput(term: Terminal, ctx: GameContext) {
    const singleCharCommands = new Set(['d', 'p', 'i', '?', 'q', 't']);

    let inputBuffer = '';
    term.onKey(({ key, domEvent }) => {
        if (domEvent.key === 'Enter') {
            term.writeln('');
            handleInput(ctx, inputBuffer.trim());
            inputBuffer = '';
        } else if (domEvent.key === 'Backspace') {
            if (inputBuffer.length > 0) {
                inputBuffer = inputBuffer.slice(0, -1);
                term.write('\b \b');
            }
        } else {
            const lower = key.toLowerCase();
            if (inputBuffer === '' && singleCharCommands.has(lower)) {
                term.writeln(key);
                handleInput(ctx, lower);
            } else {
                inputBuffer += key;
                term.write(key);
            }
        }
    });
}

function handleInput(ctx: GameContext, line: string) {
    switch (ctx.mode) {
        case 'help':
        case 'shipInfo':
            if (line.toLowerCase() === 'q') {
                ctx.setMode('sector');
                showPrompt(ctx);
            }
            return;
        case 'port':
            handlePortInput(ctx, line);
            return;
        case 'docked':
            handleDockedInput(ctx, line);
            return;
    }

    // Sector mode
    const [cmd, ...args] = line.split(/\s+/);
    if (/^\d+$/.test(cmd)) {
        ctx.sendMsg({ type: ClientMsgType.Move, sector: parseInt(cmd, 10) });
        return;
    }
    switch (cmd.toLowerCase()) {
        case '':
        case 'd':
            ctx.sendMsg({ type: ClientMsgType.SectorDisplay });
            break;
        case 'p':
            showPortMenu(ctx);
            break;
        case 'i':
            showShipInfo(ctx);
            break;
        case '?':
            showHelp(ctx);
            break;
        case 'm':
        case 'move': {
            const sector = parseInt(args[0], 10);
            if (!isNaN(sector)) ctx.sendMsg({ type: ClientMsgType.Move, sector });
            else ctx.term.writeln('Usage: move <sector>');
            break;
        }
        default:
            if (line) ctx.term.writeln(`Unknown command: ${cmd}`);
            showPrompt(ctx);
    }
}

function handlePortInput(ctx: GameContext, line: string) {
    switch (line.toLowerCase()) {
        case 't':
            ctx.sendMsg({ type: ClientMsgType.Dock });
            break;
        case 'q':
            ctx.setMode('sector');
            showPrompt(ctx);
            break;
        default:
            ctx.term.writeln('  T  Trade at this port');
            ctx.term.writeln('  Q  Never mind');
    }
}

function handleDockedInput(ctx: GameContext, line: string) {
    const [cmd, ...args] = line.split(/\s+/);
    switch (cmd.toLowerCase()) {
        case 'b':
        case 'buy': {
            const good = args[0]?.toLowerCase();
            const qty = parseInt(args[1], 10);
            if (!good || isNaN(qty) || qty <= 0) {
                ctx.term.writeln('Usage: b <fuel|organics|equipment> <quantity>');
                return;
            }
            ctx.sendMsg({
                type: ClientMsgType.PortTransaction,
                good,
                quantity: qty,
                action: 'buy',
            });
            break;
        }
        case 's':
        case 'sell': {
            const good = args[0]?.toLowerCase();
            const qty = parseInt(args[1], 10);
            if (!good || isNaN(qty) || qty <= 0) {
                ctx.term.writeln('Usage: s <fuel|organics|equipment> <quantity>');
                return;
            }
            ctx.sendMsg({
                type: ClientMsgType.PortTransaction,
                good,
                quantity: qty,
                action: 'sell',
            });
            break;
        }
        case 'q':
        case 'leave':
            ctx.sendMsg({ type: ClientMsgType.Undock });
            break;
        default:
            showDockedMenu(ctx);
    }
}

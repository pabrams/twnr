import type { Terminal } from '@xterm/xterm';
import { ClientMsgType } from '@twnr/shared';
import type { GameContext } from './display.js';
import {
    showPrompt,
    showPortMenu,
    showHelp,
    showDockedMenu,
    showPlayerInfo,
    showAttackMenu,
    showAttackFightersPrompt,
    showClass0Menu,
    showClass0QtyPrompt,
    showComputerMenu,
    showKnownUniverseMenu,
    showExploredSectors,
    showUnexploredSectors,
    showShipCatalog,
    showShipDetail,
    showPlanetSpecs,
    showPlanetDetail,
    showCurrentShipSpecs,
} from './display.js';
import { colors } from './constants.js';

export function setupInput(term: Terminal, ctx: GameContext) {
    const singleCharCommands = new Set([
        'd',
        'p',
        'i',
        '?',
        'q',
        't',
        'a',
        'c',
        'f',
        'h',
        'k',
        'j',
        'e',
        'u',
        ';',
        's',
        'y',
        'n',
        '#',
    ]);

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
        case 'playerInfo':
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
        case 'attack':
            handleAttackInput(ctx, line);
            return;
        case 'attackFighters':
            handleAttackFightersInput(ctx, line);
            return;
        case 'computer':
            handleComputerInput(ctx, line);
            return;
        case 'knownUniverse':
            handleKnownUniverseInput(ctx, line);
            return;
        case 'shipCatalog':
            handleShipCatalogInput(ctx, line);
            return;
        case 'planetSpecs':
            handlePlanetSpecsInput(ctx, line);
            return;
        case 'class0':
            handleClass0Input(ctx, line);
            return;
        case 'class0Qty':
            handleClass0QtyInput(ctx, line);
            return;
        case 'autopilotPrompt':
            handleAutopilotPromptInput(ctx, line);
            return;
        case 'autopilot':
            // Ignore input during autopilot
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
            showPlayerInfo(ctx);
            break;
        case '?':
            showHelp(ctx);
            break;
        case 'a':
            showAttackMenu(ctx);
            break;
        case 'c':
            showComputerMenu(ctx);
            break;
        case 'q':
            ctx.term.writeln(`\r\n${colors.white('Goodbye!')}`);
            ctx.ws.close();
            return;
        case '#':
            ctx.sendMsg({ type: ClientMsgType.Who });
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

function handleAttackInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.setMode('sector');
        showPrompt(ctx);
        return;
    }
    const idx = parseInt(line, 10) - 1;
    if (idx >= 0 && idx < ctx.sectorPlayers.length) {
        ctx.setAttackTarget(ctx.sectorPlayers[idx].id);
        showAttackFightersPrompt(ctx);
    } else {
        ctx.term.writeln(colors.boldRed('Invalid selection.'));
    }
}

function handleAttackFightersInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.setMode('sector');
        showPrompt(ctx);
        return;
    }
    const qty = parseInt(line, 10);
    if (isNaN(qty) || qty <= 0) {
        ctx.term.writeln('Enter a positive number.');
        return;
    }
    ctx.sendMsg({ type: ClientMsgType.Attack, targetPlayerId: ctx.attackTarget!, fighters: qty });
}

function handleComputerInput(ctx: GameContext, line: string) {
    switch (line.toLowerCase()) {
        case 'k':
            showKnownUniverseMenu(ctx);
            break;
        case 'c':
            showShipCatalog(ctx);
            break;
        case 'j':
            showPlanetSpecs(ctx);
            break;
        case ';':
            showCurrentShipSpecs(ctx);
            break;
        case 'q':
            ctx.setMode('sector');
            showPrompt(ctx);
            break;
        default:
            showComputerMenu(ctx);
    }
}

function handleKnownUniverseInput(ctx: GameContext, line: string) {
    switch (line.toLowerCase()) {
        case 'e':
            showExploredSectors(ctx);
            break;
        case 'u':
            showUnexploredSectors(ctx);
            break;
        case 'q':
            showComputerMenu(ctx);
            break;
        default:
            showKnownUniverseMenu(ctx);
    }
}

function handleShipCatalogInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        showComputerMenu(ctx);
        return;
    }
    const idx = line.toUpperCase().charCodeAt(0) - 65;
    if (ctx.shipConfigs && idx >= 0 && idx < ctx.shipConfigs.length) {
        showShipDetail(ctx, ctx.shipConfigs[idx]);
    } else {
        ctx.term.writeln(colors.boldRed('Invalid selection.'));
    }
}

function handlePlanetSpecsInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        showComputerMenu(ctx);
        return;
    }
    const idx = line.toUpperCase().charCodeAt(0) - 65;
    if (ctx.planetConfigs && idx >= 0 && idx < ctx.planetConfigs.length) {
        showPlanetDetail(ctx, ctx.planetConfigs[idx]);
    } else {
        ctx.term.writeln(colors.boldRed('Invalid selection.'));
    }
}

function handleClass0Input(ctx: GameContext, line: string) {
    switch (line.toLowerCase()) {
        case 'f':
            ctx.setClass0BuyType('fighters');
            showClass0QtyPrompt(ctx, 'fighters');
            break;
        case 's':
            ctx.setClass0BuyType('shields');
            showClass0QtyPrompt(ctx, 'shields');
            break;
        case 'h':
            ctx.setClass0BuyType('holds');
            showClass0QtyPrompt(ctx, 'holds');
            break;
        case 'q':
            ctx.sendMsg({ type: ClientMsgType.Undock });
            break;
        default:
            showClass0Menu(ctx);
    }
}

function handleAutopilotPromptInput(ctx: GameContext, line: string) {
    switch (line.toLowerCase()) {
        case 'y': {
            ctx.setMode('autopilot');
            ctx.term.writeln(`\r\n${colors.boldGreen('Autopilot engaged.')}`);
            // Start moving along the path (step 1 is the first hop, step 0 is current sector)
            const nextSector = ctx.autopilotPath[ctx.autopilotStep];
            ctx.setAutopilotStep(ctx.autopilotStep + 1);
            ctx.sendMsg({ type: ClientMsgType.Move, sector: nextSector });
            break;
        }
        case 'n':
            ctx.setMode('sector');
            showPrompt(ctx);
            break;
    }
}

function handleClass0QtyInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.setMode('class0');
        showClass0Menu(ctx);
        return;
    }
    const qty = parseInt(line, 10);
    if (isNaN(qty) || qty <= 0) {
        ctx.term.writeln('Enter a positive number.');
        return;
    }
    switch (ctx.class0BuyType) {
        case 'fighters':
            ctx.sendMsg({ type: ClientMsgType.BuyFighters, quantity: qty });
            break;
        case 'shields':
            ctx.sendMsg({ type: ClientMsgType.BuyShields, quantity: qty });
            break;
        case 'holds':
            ctx.sendMsg({ type: ClientMsgType.BuyHolds, quantity: qty });
            break;
    }
}

import type { Terminal } from '@xterm/xterm';
import { ClientMsgType } from '@twnr/shared';
import type { GameContext } from './types.js';
import { showPrompt, showPortMenu, showHelp, showDockedMenu, showPlayerInfo } from './display.js';
import { showAttackMenu } from './display-combat.js';
import { showComputerMenu } from './display-computer.js';
import { showJettisonConfirm } from './display-port.js';
import {
    handleAttackInput,
    handleAttackFightersInput,
    handleDeployFightersQtyInput,
    handleFighterEncounterInput,
    handleFighterAttackQtyInput,
} from './input-combat.js';
import {
    handleComputerInput,
    handleKnownUniverseInput,
    handleShipCatalogInput,
    handlePlanetSpecsInput,
} from './input-computer.js';
import {
    handleClass0Input,
    handleClass0QtyInput,
    handleAutopilotPromptInput,
    handleJettisonConfirmInput,
    handlePlanetInput,
    handlePlanetTakeQtyInput,
    handlePlanetLeaveQtyInput,
} from './input-misc.js';
import { colors, MenuMode } from './constants.js';

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
        'l',
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
        case MenuMode.Help:
        case MenuMode.ShipInfo:
        case MenuMode.PlayerInfo:
            if (line.toLowerCase() === 'q') {
                ctx.setMode(MenuMode.Sector);
                showPrompt(ctx);
            }
            return;
        case MenuMode.Port:
            handlePortInput(ctx, line);
            return;
        case MenuMode.Docked:
            handleDockedInput(ctx, line);
            return;
        case MenuMode.Attack:
            handleAttackInput(ctx, line);
            return;
        case MenuMode.AttackFighters:
            handleAttackFightersInput(ctx, line);
            return;
        case MenuMode.Computer:
            handleComputerInput(ctx, line);
            return;
        case MenuMode.KnownUniverse:
            handleKnownUniverseInput(ctx, line);
            return;
        case MenuMode.ShipCatalog:
            handleShipCatalogInput(ctx, line);
            return;
        case MenuMode.PlanetSpecs:
            handlePlanetSpecsInput(ctx, line);
            return;
        case MenuMode.Class0:
            handleClass0Input(ctx, line);
            return;
        case MenuMode.Class0Qty:
            handleClass0QtyInput(ctx, line);
            return;
        case MenuMode.AutopilotPrompt:
            handleAutopilotPromptInput(ctx, line);
            return;
        case MenuMode.Autopilot:
            // Ignore input during autopilot
            return;
        case MenuMode.JettisonConfirm:
            handleJettisonConfirmInput(ctx, line);
            return;
        case MenuMode.Planet:
            handlePlanetInput(ctx, line);
            return;
        case MenuMode.PlanetTakeQty:
            handlePlanetTakeQtyInput(ctx, line);
            return;
        case MenuMode.PlanetLeaveQty:
            handlePlanetLeaveQtyInput(ctx, line);
            return;
        case MenuMode.DeployFightersQty:
            handleDeployFightersQtyInput(ctx, line);
            return;
        case MenuMode.FighterEncounter:
            handleFighterEncounterInput(ctx, line);
            return;
        case MenuMode.FighterAttackQty:
            handleFighterAttackQtyInput(ctx, line);
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
        case 'f':
            ctx.sendMsg({ type: ClientMsgType.DeployFightersInfo });
            break;
        case 'j':
            showJettisonConfirm(ctx);
            break;
        case 'l':
            ctx.sendMsg({ type: ClientMsgType.Land });
            break;
        case 'q':
            ctx.term.writeln(`\r\n${colors.white('Goodbye!')}`);
            ctx.ws.close();
            return;
        case '#':
            ctx.sendMsg({ type: ClientMsgType.PlayersOnline });
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
            ctx.setMode(MenuMode.Sector);
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

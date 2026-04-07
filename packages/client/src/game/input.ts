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
import { colors } from './constants.js';

/**
 * Check if a key is valid for the current menu based on the cached registry.
 * Returns 'single' for immediate single-char commands, 'buffered' for keys
 * that begin or continue a multi-char input, or false to reject.
 */
function isValidKeyForMenu(ctx: GameContext, key: string): 'single' | 'buffered' | false {
    const menu = ctx.menuRegistry.get(ctx.mode);
    if (!menu) return 'single'; // Registry not loaded yet — permissive fallback

    const lower = key.toLowerCase();
    const hasNumberCmd = menu.commands.some((c) => c.keyPattern === '<number>');
    const hasLetterCmd = menu.commands.some((c) => c.keyPattern === '<letter>');
    const hasMultiWordCmd = menu.commands.some((c) => c.keyPattern.includes(' '));

    for (const cmd of menu.commands) {
        const kp = cmd.keyPattern;
        // Exact single-char match (e.g. 'q', 'd', 'p')
        if (kp.length === 1 && kp === lower) return 'single';
    }

    // Number input — digits start/continue buffer
    if (hasNumberCmd && /\d/.test(key)) return 'buffered';
    // Letter selection (ship catalog, planet specs)
    if (hasLetterCmd && /[a-zA-Z]/.test(key)) return 'single';
    // Multi-word command first char (e.g. 'b' for 'b <good> <qty>') or 'm' for 'move <sector>'
    if (hasMultiWordCmd || hasNumberCmd) {
        // Allow letters that start multi-word patterns
        for (const cmd of menu.commands) {
            if (cmd.keyPattern.includes(' ') && cmd.keyPattern[0] === lower) return 'buffered';
        }
        // Allow 'm' as alias prefix for move in menus with <number> commands
        if (hasNumberCmd && lower === 'm') return 'buffered';
    }

    return false;
}

export function setupInput(term: Terminal, ctx: GameContext) {
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
            const validity = isValidKeyForMenu(ctx, key);
            if (validity === false) {
                // Invalid key for current menu — reject silently
                return;
            }
            if (inputBuffer === '' && validity === 'single') {
                term.writeln(key);
                handleInput(ctx, key.toLowerCase());
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
                ctx.changeMenu('sector');
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
        case 'jettisonConfirm':
            handleJettisonConfirmInput(ctx, line);
            return;
        case 'planet':
            handlePlanetInput(ctx, line);
            return;
        case 'planetTakeQty':
            handlePlanetTakeQtyInput(ctx, line);
            return;
        case 'planetLeaveQty':
            handlePlanetLeaveQtyInput(ctx, line);
            return;
        case 'deployFightersQty':
            handleDeployFightersQtyInput(ctx, line);
            return;
        case 'fighterEncounter':
            handleFighterEncounterInput(ctx, line);
            return;
        case 'fighterAttackQty':
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
            ctx.changeMenu('sector');
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

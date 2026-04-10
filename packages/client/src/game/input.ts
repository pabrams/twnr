import type { Terminal } from '@xterm/xterm';
import { ClientMsgType } from '@twnr/shared';
import type { GameContext } from './types.js';
import { showPrompt, showPortMenu, showHelp, showPlayerInfo } from './display.js';
import { showAttackMenu } from './display-combat.js';
import { showComputerActivated } from './display-computer.js';
import { showJettisonConfirm, showTradeConfirmPrompt } from './display-port.js';
import { advanceTradeQueue } from './connection.js';
import {
    handleAttackInput,
    handleAttackDronesInput,
    handleDeployDronesQtyInput,
    handleDroneEncounterInput,
    handleDroneAttackQtyInput,
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
    handlePlanetEarthInput,
    handlePlanetTakeCommodityInput,
    handlePlanetLeaveCommodityInput,
    handlePlanetTakeQtyInput,
    handlePlanetLeaveQtyInput,
} from './input-misc.js';
import {
    handleStarbaseInput,
    handleHardwareInput,
    handleStarbaseBuyQtyInput,
    handlePlanetSelectInput,
    handleHyperspaceJumpInput,
    handleShipyardsInput,
    handleShipyardsBuyInput,
    handleShipyardsTradeinInput,
    handleShipyardsExamineInput,
    handleShipyardsClass0Input,
    handleShipyardsClass0QtyInput,
} from './input-starbase.js';
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
        if (key === '~') {
            ctx.setDebug(!ctx.debug);
            return;
        }
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
    // Ignore input during autopilot
    if (ctx.autopilotPath.length > 0 && ctx.autopilotStep > 0) return;

    switch (ctx.mode) {
        case 'port':
            handlePortInput(ctx, line);
            return;
        case 'tradeQty':
            handleTradeQtyInput(ctx, line);
            return;
        case 'tradeConfirm':
            handleTradeConfirmInput(ctx, line);
            return;
        case 'attack':
            handleAttackInput(ctx, line);
            return;
        case 'attackDrones':
            handleAttackDronesInput(ctx, line);
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
        case 'jettisonConfirm':
            handleJettisonConfirmInput(ctx, line);
            return;
        case 'planet':
            handlePlanetInput(ctx, line);
            return;
        case 'planetEarth':
            handlePlanetEarthInput(ctx, line);
            return;
        case 'planetTakeCommodity':
            handlePlanetTakeCommodityInput(ctx, line);
            return;
        case 'planetLeaveCommodity':
            handlePlanetLeaveCommodityInput(ctx, line);
            return;
        case 'planetTakeQty':
            handlePlanetTakeQtyInput(ctx, line);
            return;
        case 'planetLeaveQty':
            handlePlanetLeaveQtyInput(ctx, line);
            return;
        case 'deployDronesQty':
            handleDeployDronesQtyInput(ctx, line);
            return;
        case 'droneEncounter':
            handleDroneEncounterInput(ctx, line);
            return;
        case 'droneAttackQty':
            handleDroneAttackQtyInput(ctx, line);
            return;
        case 'starbase':
            handleStarbaseInput(ctx, line);
            return;
        case 'starbaseHardware':
            handleHardwareInput(ctx, line);
            return;
        case 'starbaseBuyQty':
            handleStarbaseBuyQtyInput(ctx, line);
            return;
        case 'shipyards':
            handleShipyardsInput(ctx, line);
            return;
        case 'shipyardsBuy':
            handleShipyardsBuyInput(ctx, line);
            return;
        case 'shipyardsTradein':
            handleShipyardsTradeinInput(ctx, line);
            return;
        case 'shipyardsExamine':
            handleShipyardsExamineInput(ctx, line);
            return;
        case 'shipyardsClass0':
            handleShipyardsClass0Input(ctx, line);
            return;
        case 'shipyardsClass0Qty':
            handleShipyardsClass0QtyInput(ctx, line);
            return;
        case 'planetSelect':
            handlePlanetSelectInput(ctx, line);
            return;
        case 'hyperspaceJumpTarget':
            handleHyperspaceJumpInput(ctx, line);
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
            ctx.changeMenu('port');
            showPortMenu(ctx);
            break;
        case 'i':
            showPlayerInfo(ctx);
            break;
        case '?':
            showHelp(ctx);
            break;
        case 'a':
            ctx.changeMenu('attack');
            showAttackMenu(ctx);
            break;
        case 'c':
            ctx.changeMenu('computer');
            showComputerActivated(ctx);
            break;
        case 'f':
            ctx.sendMsg({ type: ClientMsgType.DeployDronesInfo });
            break;
        case 'j':
            ctx.changeMenu('jettisonConfirm');
            showJettisonConfirm(ctx);
            break;
        case 'g':
            ctx.sendMsg({ type: ClientMsgType.ListDeployedDrones });
            break;
        case 'l':
            ctx.sendMsg({ type: ClientMsgType.Land });
            break;
        case 'u':
            ctx.sendMsg({ type: ClientMsgType.UseTerraformDevice });
            break;
        case 'v':
            if (ctx.starbaseSector != null) {
                ctx.term.writeln(
                    `\r\n${colors.boldCyan('Starbase')} is in sector ${colors.boldCyan(String(ctx.starbaseSector))}`,
                );
            } else {
                ctx.term.writeln(`\r\n${colors.white('No Starbase in this universe.')}`);
            }
            showPrompt(ctx);
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
            if (ctx.currentPort?.class !== 9) {
                ctx.sendMsg({ type: ClientMsgType.Dock });
            }
            break;
        case 's':
            if (ctx.currentPort?.class === 9) {
                ctx.sendMsg({ type: ClientMsgType.DockStarbase });
            }
            break;
        case 'q':
            ctx.changeMenu('sector');
            showPrompt(ctx);
            break;
    }
}

function handleTradeQtyInput(ctx: GameContext, line: string) {
    const step = ctx.tradeQueue[ctx.tradeStep];
    if (!step) return;
    const trimmed = line.trim();
    // Empty input = accept default (maxQty)
    const qty = trimmed === '' ? step.maxQty : parseInt(trimmed, 10);
    if (isNaN(qty) || qty < 0) return;
    if (qty === 0) {
        // Skip this commodity
        advanceTradeQueue(ctx);
        return;
    }
    const clampedQty = Math.min(qty, step.maxQty);
    ctx.setTradePendingQty(clampedQty);
    ctx.term.writeln(`${colors.white(`Agreed, ${clampedQty.toLocaleString()} units.`)}`);
    const totalPrice = clampedQty * step.price;
    ctx.setMode('tradeConfirm');
    showTradeConfirmPrompt(ctx, totalPrice, step.action);
}

function handleTradeConfirmInput(ctx: GameContext, line: string) {
    const step = ctx.tradeQueue[ctx.tradeStep];
    if (!step) return;
    switch (line.toLowerCase()) {
        case 'y': {
            const totalPrice = ctx.tradePendingQty * step.price;
            if (step.action === 'buy' && ctx.tradeCredits < totalPrice) {
                ctx.term.writeln(`\r\n${colors.boldRed('Insufficient credits!')}`);
                advanceTradeQueue(ctx);
                return;
            }
            ctx.sendMsg({
                type: ClientMsgType.PortTransaction,
                good: step.commodity,
                quantity: ctx.tradePendingQty,
                action: step.action,
            });
            break;
        }
        case 'n':
            advanceTradeQueue(ctx);
            break;
    }
}

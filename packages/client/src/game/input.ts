import type { Terminal } from '@xterm/xterm';
import { ClientMsgType, Menu } from '@twnr/shared';
import type { GameContext, KeystrokeEvent } from './types.js';
import {
    echoCommand,
    showPrompt,
    showPortMenu,
    showHelp,
    showPlayerInfo,
    showMoveMenu,
    hideMoveMenuOverlay,
} from './display.js';
import { showComputerActivated } from './display-computer.js';
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
import { render } from './renderer.js';
import { NOTIFY } from './messages/index.js';

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
    // Ignore input during autopilot (but allow when paused for encounters)
    if (ctx.autopilotPath.length > 0 && ctx.autopilotStep > 0 && !ctx.autopilotPaused) return;

    switch (ctx.mode) {
        case Menu.Port:
            handlePortInput(ctx, line);
            return;
        case Menu.TradeQty:
            handleTradeQtyInput(ctx, line);
            return;
        case Menu.TradeConfirm:
            handleTradeConfirmInput(ctx, line);
            return;
        case Menu.Attack:
            handleAttackInput(ctx, line);
            return;
        case Menu.AttackDrones:
            handleAttackDronesInput(ctx, line);
            return;
        case Menu.Computer:
            handleComputerInput(ctx, line);
            return;
        case Menu.KnownUniverse:
            handleKnownUniverseInput(ctx, line);
            return;
        case Menu.ShipCatalog:
            handleShipCatalogInput(ctx, line);
            return;
        case Menu.PlanetSpecs:
            handlePlanetSpecsInput(ctx, line);
            return;
        case Menu.Class0:
            handleClass0Input(ctx, line);
            return;
        case Menu.Class0Qty:
            handleClass0QtyInput(ctx, line);
            return;
        case Menu.AutopilotPrompt:
            handleAutopilotPromptInput(ctx, line);
            return;
        case Menu.JettisonConfirm:
            handleJettisonConfirmInput(ctx, line);
            return;
        case Menu.Planet:
            handlePlanetInput(ctx, line);
            return;
        case Menu.PlanetEarth:
            handlePlanetEarthInput(ctx, line);
            return;
        case Menu.PlanetTakeCommodity:
            handlePlanetTakeCommodityInput(ctx, line);
            return;
        case Menu.PlanetLeaveCommodity:
            handlePlanetLeaveCommodityInput(ctx, line);
            return;
        case Menu.PlanetTakeQty:
            handlePlanetTakeQtyInput(ctx, line);
            return;
        case Menu.PlanetLeaveQty:
            handlePlanetLeaveQtyInput(ctx, line);
            return;
        case Menu.DeployDronesQty:
            handleDeployDronesQtyInput(ctx, line);
            return;
        case Menu.DroneEncounter:
            handleDroneEncounterInput(ctx, line);
            return;
        case Menu.DroneAttackQty:
            handleDroneAttackQtyInput(ctx, line);
            return;
        case Menu.Starbase:
            handleStarbaseInput(ctx, line);
            return;
        case Menu.StarbaseHardware:
            handleHardwareInput(ctx, line);
            return;
        case Menu.StarbaseBuyQty:
            handleStarbaseBuyQtyInput(ctx, line);
            return;
        case Menu.Shipyards:
            handleShipyardsInput(ctx, line);
            return;
        case Menu.ShipyardsBuy:
            handleShipyardsBuyInput(ctx, line);
            return;
        case Menu.ShipyardsTradein:
            handleShipyardsTradeinInput(ctx, line);
            return;
        case Menu.ShipyardsExamine:
            handleShipyardsExamineInput(ctx, line);
            return;
        case Menu.ShipyardsClass0:
            handleShipyardsClass0Input(ctx, line);
            return;
        case Menu.ShipyardsClass0Qty:
            handleShipyardsClass0QtyInput(ctx, line);
            return;
        case Menu.PlanetSelect:
            handlePlanetSelectInput(ctx, line);
            return;
        case Menu.HyperspaceJumpTarget:
            handleHyperspaceJumpInput(ctx, line);
            return;
        case Menu.Move:
            handleMoveMenuInput(ctx, line);
            return;
        case Menu.QuitConfirm:
            handleQuitConfirmInput(ctx, line);
            return;
        case Menu.TerraformConfirm:
            handleTerraformConfirmInput(ctx, line);
            return;
    }

    // Sector mode
    const cmd = line.trim();
    if (/^\d+$/.test(cmd)) {
        const sector = parseInt(cmd, 10);
        echoCommand(ctx, 'move', { sector });
        ctx.sendMsg({ type: ClientMsgType.Move, sector });
        return;
    }
    switch (cmd.toLowerCase()) {
        case '<':
            echoCommand(ctx, 'moveToPrevious');
            ctx.sendMsg({ type: ClientMsgType.MoveToPrevious });
            break;
        case '':
            echoCommand(ctx, 'sectorDisplay');
            ctx.sendMsg({ type: ClientMsgType.SectorDisplay });
            break;
        case 'p':
            if (!ctx.currentPort) {
                showPortMenu(ctx); // renders "No port in this sector." + sector prompt
                break;
            }
            echoCommand(ctx, 'portInfo');
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Port });
            break;
        case 'i':
            echoCommand(ctx, 'shipInfo');
            showPlayerInfo(ctx);
            break;
        case '?':
            showHelp(ctx);
            break;
        case 'a':
            echoCommand(ctx, 'attack');
            ctx.sendMsg({ type: ClientMsgType.Attack });
            break;
        case 'c':
            // Computer activation banner is local UI flourish; the real menu
            // prompt is rendered by the MenuChanged dispatcher.
            showComputerActivated(ctx);
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Computer });
            break;
        case 'm':
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Move });
            break;
        case 'd':
            echoCommand(ctx, 'deployDronesInfo');
            ctx.sendMsg({ type: ClientMsgType.DeployDronesInfo });
            break;
        case 'j':
            echoCommand(ctx, 'jettison');
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.JettisonConfirm });
            break;
        case 'g':
            echoCommand(ctx, 'listDeployedDrones');
            ctx.sendMsg({ type: ClientMsgType.ListDeployedDrones });
            break;
        case 'l':
            echoCommand(ctx, 'land');
            ctx.sendMsg({ type: ClientMsgType.Land });
            break;
        case 'u':
            echoCommand(ctx, 'terraformInfo');
            ctx.sendMsg({ type: ClientMsgType.TerraformInfo });
            break;
        case 'v':
            echoCommand(ctx, 'starbaseInfo');
            ctx.sendMsg({ type: ClientMsgType.StarbaseInfo });
            break;
        case 'q':
            echoCommand(ctx, 'quit');
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.QuitConfirm });
            break;
        case '#':
            echoCommand(ctx, 'playersOnline');
            ctx.sendMsg({ type: ClientMsgType.PlayersOnline });
            break;
        default:
            if (line) ctx.term.writeln(render(NOTIFY.unknownCommand, { cmd }));
            showPrompt(ctx);
    }
}

function handleQuitConfirmInput(ctx: GameContext, line: string) {
    const t = line.trim().toLowerCase();
    switch (t) {
        case 'y':
            ctx.term.writeln(render(NOTIFY.goodbye));
            ctx.ws.close();
            return;
        case '':
        case 'n':
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
            return;
        default:
            ctx.term.write(render(NOTIFY.quitConfirm));
    }
}

function handleTerraformConfirmInput(ctx: GameContext, line: string) {
    const t = line.trim().toLowerCase();
    switch (t) {
        case 'y':
            echoCommand(ctx, 'useTerraformDevice');
            ctx.sendMsg({ type: ClientMsgType.UseTerraformDevice });
            return;
        case '':
        case 'n':
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
            return;
        default:
            ctx.term.write(render(NOTIFY.terraformConfirm));
    }
}

function handleMoveMenuInput(ctx: GameContext, line: string) {
    const cmd = line.trim();
    if (cmd === '') {
        showMoveMenu(ctx);
        return;
    }
    if (cmd.toLowerCase() === 'q') {
        hideMoveMenuOverlay(ctx);
        ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
        return;
    }
    const warps = ctx.currentWarps.slice(0, 6);
    const idx = parseInt(cmd, 10) - 1;
    if (idx >= 0 && idx < warps.length) {
        hideMoveMenuOverlay(ctx);
        const sector = warps[idx].sector;
        echoCommand(ctx, 'move', { sector });
        ctx.sendMsg({ type: ClientMsgType.Move, sector });
        return;
    }
    ctx.term.writeln(render(NOTIFY.invalidSelection));
    showMoveMenu(ctx);
}

function handlePortInput(ctx: GameContext, line: string) {
    switch (line.toLowerCase()) {
        case 't':
            if (ctx.currentPort?.class !== 9) {
                echoCommand(ctx, 'dock');
                ctx.sendMsg({ type: ClientMsgType.Dock });
            }
            break;
        case 's':
            if (ctx.currentPort?.class === 9) {
                echoCommand(ctx, 'dockStarbase');
                ctx.sendMsg({ type: ClientMsgType.DockStarbase });
            }
            break;
        case 'q':
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
            break;
    }
}

function handleTradeQtyInput(ctx: GameContext, line: string) {
    const trimmed = line.trim();
    // Empty input = accept default
    const qty = trimmed === '' ? -1 : parseInt(trimmed, 10);
    if (isNaN(qty) || qty < -1) return;
    // -1 signals "use default maxQty" to the server, 0 = skip.
    // The TradeResponse here is the qty submission for an in-progress
    // trade flow (the <Trade at Port> echo already fired when the user
    // pressed T at the port menu); no echo at this step.
    ctx.sendMsg({ type: ClientMsgType.TradeResponse, quantity: qty === -1 ? -1 : qty });
}

function handleTradeConfirmInput(ctx: GameContext, line: string) {
    switch (line.toLowerCase()) {
        case '':
        case 'y':
            ctx.sendMsg({ type: ClientMsgType.TradeConfirmResponse, confirmed: true });
            break;
        case 'n':
            ctx.sendMsg({ type: ClientMsgType.TradeConfirmResponse, confirmed: false });
            break;
    }
}

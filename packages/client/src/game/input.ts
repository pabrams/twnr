import type { Terminal } from '@xterm/xterm';
import { ClientMsgType, Menu } from '@twnr/shared';
import type { GameContext } from './types.js';
import { showPrompt, showPortMenu, showHelp, showPlayerInfo } from './display.js';
import { showAttackMenu } from './display-combat.js';
import { showComputerActivated } from './display-computer.js';
import { showJettisonConfirm } from './display-port.js';
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
                term.writeln('');
                handleInput(ctx, key.toLowerCase());
            } else {
                inputBuffer += key;
                term.write(key);
            }
        }
    });
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
    }

    // Sector mode
    const cmd = line.trim();
    if (/^\d+$/.test(cmd)) {
        ctx.sendMsg({ type: ClientMsgType.Move, sector: parseInt(cmd, 10) });
        return;
    }
    switch (cmd.toLowerCase()) {
        case '<':
            ctx.sendMsg({ type: ClientMsgType.MoveToPrevious });
            break;
        case '':
            ctx.sendMsg({ type: ClientMsgType.SectorDisplay });
            break;
        case 'p':
            ctx.changeMenu(Menu.Port);
            showPortMenu(ctx);
            break;
        case 'i':
            showPlayerInfo(ctx);
            break;
        case '?':
            showHelp(ctx);
            break;
        case 'a':
            if (ctx.sectorPlayers.length === 0) {
                showAttackMenu(ctx);
                break;
            }
            ctx.changeMenu(Menu.Attack);
            showAttackMenu(ctx);
            break;
        case 'c':
            ctx.changeMenu(Menu.Computer);
            showComputerActivated(ctx);
            break;
        case 'd':
            ctx.sendMsg({ type: ClientMsgType.DeployDronesInfo });
            break;
        case 'j':
            ctx.changeMenu(Menu.JettisonConfirm);
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
                ctx.term.writeln(render(NOTIFY.starbaseLocation, { sector: ctx.starbaseSector }));
            } else {
                ctx.term.writeln(render(NOTIFY.noStarbase));
            }
            showPrompt(ctx);
            break;
        case 'q':
            ctx.term.writeln(render(NOTIFY.goodbye));
            ctx.ws.close();
            return;
        case '#':
            ctx.sendMsg({ type: ClientMsgType.PlayersOnline });
            break;
        default:
            if (line) ctx.term.writeln(render(NOTIFY.unknownCommand, { cmd }));
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
            ctx.changeMenu(Menu.Sector);
            showPrompt(ctx);
            break;
    }
}

function handleTradeQtyInput(ctx: GameContext, line: string) {
    const trimmed = line.trim();
    // Empty input = accept default
    const qty = trimmed === '' ? -1 : parseInt(trimmed, 10);
    if (isNaN(qty) || qty < -1) return;
    // -1 signals "use default maxQty" to the server, 0 = skip
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

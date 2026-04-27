import { ClientMsgType, Menu } from '@twnr/shared';
import type { GameContext } from './types.js';
import { echoCommand } from './display.js';
import { letterToIndex } from './display-starbase.js';
import {
    showComputerHelp,
    showComputerPrompt,
    showComputerDeactivated,
    showKnownUniverseMenu,
    showExploredSectors,
    showUnexploredSectors,
    showShipCatalog,
    showShipDetail,
    showShipInterestPrompt,
    showPlanetDetail,
    showCurrentShipSpecs,
    showTraderList,
} from './display-computer.js';
import { render } from './renderer.js';
import { NOTIFY } from './messages/index.js';

export function handleComputerInput(ctx: GameContext, line: string) {
    switch (line.toLowerCase()) {
        case 'k':
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.KnownUniverse });
            break;
        case 'l':
            showTraderList(ctx);
            break;
        case 'c':
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.ShipCatalog });
            break;
        case 'j':
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.PlanetSpecs });
            break;
        case ';':
            showCurrentShipSpecs(ctx);
            break;
        case 'y':
            echoCommand(ctx, 'listPlanets');
            ctx.sendMsg({ type: ClientMsgType.ListPlanets });
            break;
        case '?':
            showComputerHelp(ctx);
            break;
        case 'q':
            // Local "computer deactivated" flourish; the dispatcher will paint
            // the sector prompt after the server confirms the transition.
            showComputerDeactivated(ctx);
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
            break;
        default:
            showComputerPrompt(ctx);
    }
}

export function handleKnownUniverseInput(ctx: GameContext, line: string) {
    switch (line.toLowerCase()) {
        case 'e':
            showExploredSectors(ctx);
            break;
        case 'u':
            showUnexploredSectors(ctx);
            break;
        case 'q':
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Computer });
            break;
        default:
            showKnownUniverseMenu(ctx);
    }
}

export function handleShipCatalogInput(ctx: GameContext, line: string) {
    const lower = line.toLowerCase();
    if (lower === 'q') {
        ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Computer });
        return;
    }
    if (lower === '?') {
        showShipCatalog(ctx);
        showShipInterestPrompt(ctx);
        return;
    }
    const idx = letterToIndex(line);
    if (ctx.shipConfigs && idx >= 0 && idx < ctx.shipConfigs.length) {
        showShipDetail(ctx, ctx.shipConfigs[idx]);
        showShipInterestPrompt(ctx);
    } else {
        ctx.term.writeln(render(NOTIFY.invalidSelection));
        showShipInterestPrompt(ctx);
    }
}

export function handlePlanetSpecsInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Computer });
        return;
    }
    const idx = letterToIndex(line);
    if (ctx.planetConfigs && idx >= 0 && idx < ctx.planetConfigs.length) {
        showPlanetDetail(ctx, ctx.planetConfigs[idx]);
    } else {
        ctx.term.writeln(render(NOTIFY.invalidSelection));
    }
}

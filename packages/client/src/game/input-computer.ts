import { ClientMsgType, Menu } from '@twnr/shared';
import type { GameContext } from './types.js';
import { echoCommand, showPrompt } from './display.js';
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
    showPlanetSpecs,
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
            showKnownUniverseMenu(ctx);
            break;
        case 'l':
            showTraderList(ctx);
            break;
        case 'c':
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.ShipCatalog });
            showShipCatalog(ctx);
            break;
        case 'j':
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.PlanetSpecs });
            showPlanetSpecs(ctx);
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
            showComputerDeactivated(ctx);
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
            showPrompt(ctx);
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
            showComputerPrompt(ctx);
            break;
        default:
            showKnownUniverseMenu(ctx);
    }
}

export function handleShipCatalogInput(ctx: GameContext, line: string) {
    const lower = line.toLowerCase();
    if (lower === 'q') {
        ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Computer });
        showComputerPrompt(ctx);
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
        showComputerPrompt(ctx);
        return;
    }
    const idx = letterToIndex(line);
    if (ctx.planetConfigs && idx >= 0 && idx < ctx.planetConfigs.length) {
        showPlanetDetail(ctx, ctx.planetConfigs[idx]);
    } else {
        ctx.term.writeln(render(NOTIFY.invalidSelection));
    }
}

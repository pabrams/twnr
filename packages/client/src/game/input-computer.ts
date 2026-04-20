import { ClientMsgType, Menu } from '@twnr/shared';
import type { GameContext } from './types.js';
import { showPrompt } from './display.js';
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
            ctx.changeMenu(Menu.KnownUniverse);
            showKnownUniverseMenu(ctx);
            break;
        case 'l':
            showTraderList(ctx);
            break;
        case 'c':
            ctx.changeMenu(Menu.ShipCatalog);
            showShipCatalog(ctx);
            break;
        case 'j':
            ctx.changeMenu(Menu.PlanetSpecs);
            showPlanetSpecs(ctx);
            break;
        case ';':
            showCurrentShipSpecs(ctx);
            break;
        case 'y':
            ctx.sendMsg({ type: ClientMsgType.ListPlanets });
            break;
        case '?':
            showComputerHelp(ctx);
            break;
        case 'q':
            showComputerDeactivated(ctx);
            ctx.changeMenu(Menu.Sector);
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
            ctx.changeMenu(Menu.Computer);
            showComputerPrompt(ctx);
            break;
        default:
            showKnownUniverseMenu(ctx);
    }
}

export function handleShipCatalogInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.changeMenu(Menu.Computer);
        showComputerPrompt(ctx);
        return;
    }
    const idx = letterToIndex(line);
    if (ctx.shipConfigs && idx >= 0 && idx < ctx.shipConfigs.length) {
        showShipDetail(ctx, ctx.shipConfigs[idx]);
    } else {
        ctx.term.writeln(render(NOTIFY.invalidSelection));
    }
}

export function handlePlanetSpecsInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.changeMenu(Menu.Computer);
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

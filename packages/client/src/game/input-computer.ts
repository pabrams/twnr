import { ClientMsgType } from '@twnr/shared';
import type { GameContext } from './types.js';
import { showPrompt } from './display.js';
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
import { colors } from './constants.js';

export function handleComputerInput(ctx: GameContext, line: string) {
    switch (line.toLowerCase()) {
        case 'k':
            ctx.changeMenu('knownUniverse');
            showKnownUniverseMenu(ctx);
            break;
        case 'l':
            showTraderList(ctx);
            break;
        case 'c':
            ctx.changeMenu('shipCatalog');
            showShipCatalog(ctx);
            break;
        case 'j':
            ctx.changeMenu('planetSpecs');
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
            ctx.changeMenu('sector');
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
            ctx.changeMenu('computer');
            showComputerPrompt(ctx);
            break;
        default:
            showKnownUniverseMenu(ctx);
    }
}

export function handleShipCatalogInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.changeMenu('computer');
        showComputerPrompt(ctx);
        return;
    }
    const idx = line.toUpperCase().charCodeAt(0) - 65;
    if (ctx.shipConfigs && idx >= 0 && idx < ctx.shipConfigs.length) {
        showShipDetail(ctx, ctx.shipConfigs[idx]);
    } else {
        ctx.term.writeln(colors.boldRed('Invalid selection.'));
    }
}

export function handlePlanetSpecsInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.changeMenu('computer');
        showComputerPrompt(ctx);
        return;
    }
    const idx = line.toUpperCase().charCodeAt(0) - 65;
    if (ctx.planetConfigs && idx >= 0 && idx < ctx.planetConfigs.length) {
        showPlanetDetail(ctx, ctx.planetConfigs[idx]);
    } else {
        ctx.term.writeln(colors.boldRed('Invalid selection.'));
    }
}

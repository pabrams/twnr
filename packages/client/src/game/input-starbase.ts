import { ClientMsgType } from '@twnr/shared';
import type { GameContext } from './types.js';
import { showPrompt } from './display.js';
import { showStarbaseMenu, showHardwareMenu, showBuyQtyPrompt } from './display-starbase.js';
import { showShipCatalog } from './display-computer.js';
import { colors } from './constants.js';

export function handleStarbaseInput(ctx: GameContext, line: string) {
    switch (line.toLowerCase()) {
        case 's':
            ctx.changeMenu('shipCatalog');
            showShipCatalog(ctx);
            break;
        case 'h':
            ctx.changeMenu('starbaseHardware');
            showHardwareMenu(ctx);
            break;
        case 'd':
            ctx.sendMsg({ type: ClientMsgType.ListDeployedDrones });
            break;
        case 'q':
            ctx.sendMsg({ type: ClientMsgType.LeaveStarbase });
            break;
        default:
            showStarbaseMenu(ctx);
    }
}

export function handleHardwareInput(ctx: GameContext, line: string) {
    switch (line.toLowerCase()) {
        case 'b':
            (ctx as any).starbaseBuyType = 'planetBusters';
            ctx.changeMenu('starbaseBuyQty');
            showBuyQtyPrompt(ctx, 'Planet Busters');
            break;
        case 't':
            (ctx as any).starbaseBuyType = 'terraformDevices';
            ctx.changeMenu('starbaseBuyQty');
            showBuyQtyPrompt(ctx, 'Terraform Devices');
            break;
        case 'w':
            ctx.sendMsg({ type: ClientMsgType.BuyHyperwarpDrive });
            break;
        case 'q':
            ctx.changeMenu('starbase');
            showStarbaseMenu(ctx);
            break;
        default:
            showHardwareMenu(ctx);
    }
}

export function handleStarbaseBuyQtyInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.changeMenu('starbaseHardware');
        showHardwareMenu(ctx);
        return;
    }
    const qty = parseInt(line, 10);
    if (isNaN(qty) || qty <= 0) {
        ctx.term.writeln('Enter a positive number.');
        return;
    }
    const buyType = (ctx as any).starbaseBuyType;
    if (buyType === 'planetBusters') {
        ctx.sendMsg({ type: ClientMsgType.BuyPlanetBusters, quantity: qty });
    } else if (buyType === 'terraformDevices') {
        ctx.sendMsg({ type: ClientMsgType.BuyTerraformDevices, quantity: qty });
    }
}

export function handlePlanetSelectInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.changeMenu('sector');
        showPrompt(ctx);
        return;
    }
    const idx = parseInt(line, 10) - 1;
    const planets = (ctx as any).landablePlanets;
    if (planets && idx >= 0 && idx < planets.length) {
        ctx.sendMsg({ type: ClientMsgType.LandOnPlanet, planetId: planets[idx].id });
    } else {
        ctx.term.writeln(colors.boldRed('Invalid selection.'));
    }
}

export function handleHyperspaceJumpInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.changeMenu('computer');
        return;
    }
    const sector = parseInt(line, 10);
    if (isNaN(sector) || sector <= 0) {
        ctx.term.writeln('Enter a valid sector number.');
        return;
    }
    ctx.sendMsg({ type: ClientMsgType.HyperspaceJump, targetSector: sector });
}

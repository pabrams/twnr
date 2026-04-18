import { ClientMsgType, Menu } from '@twnr/shared';
import type { GameContext } from './types.js';
import { showPrompt } from './display.js';
import { showClass0Menu, showClass0QtyPrompt } from './display-port.js';
import {
    showPlanetTakePrompt,
    showPlanetLeavePrompt,
    showPlanetTakeCommodityMenu,
    showPlanetLeaveCommodityMenu,
    showPlanetMenuOptions,
    showPlanetHelp,
} from './display-planet.js';
import { render } from './renderer.js';
import { NOTIFY } from './messages/index.js';

export function handleClass0Input(ctx: GameContext, line: string) {
    switch (line.toLowerCase()) {
        case 'f':
            ctx.class0BuyType = 'drones';
            ctx.changeMenu(Menu.Class0Qty);
            showClass0QtyPrompt(ctx, 'drones');
            break;
        case 's':
            ctx.class0BuyType = 'shields';
            ctx.changeMenu(Menu.Class0Qty);
            showClass0QtyPrompt(ctx, 'shields');
            break;
        case 'h':
            ctx.class0BuyType = 'holds';
            ctx.changeMenu(Menu.Class0Qty);
            showClass0QtyPrompt(ctx, 'holds');
            break;
        case 'q':
            ctx.sendMsg({ type: ClientMsgType.Undock });
            break;
        default:
            showClass0Menu(ctx);
    }
}

export function handleClass0QtyInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.changeMenu(Menu.Class0);
        showClass0Menu(ctx);
        return;
    }
    const qty = parseInt(line, 10);
    if (isNaN(qty) || qty <= 0) {
        ctx.term.writeln('Enter a positive number.');
        return;
    }
    switch (ctx.class0BuyType) {
        case 'drones':
            ctx.sendMsg({ type: ClientMsgType.BuyDrones, quantity: qty });
            break;
        case 'shields':
            ctx.sendMsg({ type: ClientMsgType.BuyShields, quantity: qty });
            break;
        case 'holds':
            ctx.sendMsg({ type: ClientMsgType.BuyHolds, quantity: qty });
            break;
    }
}

export function handleAutopilotPromptInput(ctx: GameContext, line: string) {
    switch (line.toLowerCase()) {
        case 'y': {
            ctx.term.writeln(render(NOTIFY.autopilotEngaged));
            const nextSector = ctx.autopilotPath[1];
            ctx.autopilotStep = 2;
            ctx.sendMsg({ type: ClientMsgType.Move, sector: nextSector });
            break;
        }
        case 'n':
            ctx.autopilotPath = [];
            ctx.autopilotStep = 0;
            ctx.changeMenu(Menu.Sector);
            showPrompt(ctx);
            break;
    }
}

export function handleJettisonConfirmInput(ctx: GameContext, line: string) {
    switch (line.toLowerCase()) {
        case 'y':
            ctx.sendMsg({ type: ClientMsgType.Jettison });
            ctx.changeMenu(Menu.Sector);
            break;
        case '':
        case 'n':
            ctx.changeMenu(Menu.Sector);
            showPrompt(ctx);
            break;
    }
}

export function handlePlanetInput(ctx: GameContext, line: string) {
    switch (line.toLowerCase()) {
        case 't':
            ctx.changeMenu(Menu.PlanetTakeCommodity);
            showPlanetTakeCommodityMenu(ctx);
            break;
        case 'l':
            ctx.changeMenu(Menu.PlanetLeaveCommodity);
            showPlanetLeaveCommodityMenu(ctx);
            break;
        case 'd':
            ctx.sendMsg({ type: ClientMsgType.PlanetDisplay });
            break;
        case 'z':
            ctx.sendMsg({ type: ClientMsgType.DestroyPlanet });
            break;
        case 'q':
            ctx.sendMsg({ type: ClientMsgType.LeavePlanet });
            break;
        case '?':
            showPlanetHelp(ctx);
            break;
    }
}

export function handlePlanetEarthInput(ctx: GameContext, line: string) {
    switch (line.toLowerCase()) {
        case 't':
            ctx.colonistCommodity = 'fuel';
            ctx.changeMenu(Menu.PlanetTakeQty);
            showPlanetTakePrompt(ctx);
            break;
        case 'l':
            ctx.colonistCommodity = 'fuel';
            ctx.changeMenu(Menu.PlanetLeaveQty);
            showPlanetLeavePrompt(ctx);
            break;
        case 'q':
            ctx.sendMsg({ type: ClientMsgType.LeavePlanet });
            break;
    }
}

export function handlePlanetTakeCommodityInput(ctx: GameContext, line: string) {
    switch (line.toLowerCase()) {
        case 'f':
            ctx.colonistCommodity = 'fuel';
            ctx.changeMenu(Menu.PlanetTakeQty);
            showPlanetTakePrompt(ctx);
            break;
        case 'o':
            ctx.colonistCommodity = 'organics';
            ctx.changeMenu(Menu.PlanetTakeQty);
            showPlanetTakePrompt(ctx);
            break;
        case 'e':
            ctx.colonistCommodity = 'equipment';
            ctx.changeMenu(Menu.PlanetTakeQty);
            showPlanetTakePrompt(ctx);
            break;
        case 'q':
            ctx.changeMenu(Menu.Planet);
            showPlanetMenuOptions(ctx);
            break;
    }
}

export function handlePlanetLeaveCommodityInput(ctx: GameContext, line: string) {
    switch (line.toLowerCase()) {
        case 'f':
            ctx.colonistCommodity = 'fuel';
            ctx.changeMenu(Menu.PlanetLeaveQty);
            showPlanetLeavePrompt(ctx);
            break;
        case 'o':
            ctx.colonistCommodity = 'organics';
            ctx.changeMenu(Menu.PlanetLeaveQty);
            showPlanetLeavePrompt(ctx);
            break;
        case 'e':
            ctx.colonistCommodity = 'equipment';
            ctx.changeMenu(Menu.PlanetLeaveQty);
            showPlanetLeavePrompt(ctx);
            break;
        case 'q':
            ctx.changeMenu(Menu.Planet);
            showPlanetMenuOptions(ctx);
            break;
    }
}

export function handlePlanetTakeQtyInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.changeMenu(Menu.Sector);
        showPrompt(ctx);
        return;
    }
    const qty = parseInt(line, 10);
    if (isNaN(qty) || qty <= 0) {
        ctx.term.writeln('Enter a positive number.');
        return;
    }
    ctx.sendMsg({
        type: ClientMsgType.TakeColonists,
        quantity: qty,
        commodity: ctx.colonistCommodity ?? 'fuel',
    });
}

export function handlePlanetLeaveQtyInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.changeMenu(Menu.Sector);
        showPrompt(ctx);
        return;
    }
    const qty = parseInt(line, 10);
    if (isNaN(qty) || qty <= 0) {
        ctx.term.writeln('Enter a positive number.');
        return;
    }
    ctx.sendMsg({
        type: ClientMsgType.LeaveColonists,
        quantity: qty,
        commodity: ctx.colonistCommodity ?? 'fuel',
    });
}

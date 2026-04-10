import { ClientMsgType } from '@twnr/shared';
import type { GameContext } from './types.js';
import { showPrompt } from './display.js';
import { showClass0Menu, showClass0QtyPrompt } from './display-port.js';
import { showPlanetTakePrompt, showPlanetLeavePrompt } from './display-planet.js';
import { colors } from './constants.js';

export function handleClass0Input(ctx: GameContext, line: string) {
    switch (line.toLowerCase()) {
        case 'f':
            ctx.setClass0BuyType('drones');
            ctx.changeMenu('class0Qty');
            showClass0QtyPrompt(ctx, 'drones');
            break;
        case 's':
            ctx.setClass0BuyType('shields');
            ctx.changeMenu('class0Qty');
            showClass0QtyPrompt(ctx, 'shields');
            break;
        case 'h':
            ctx.setClass0BuyType('holds');
            ctx.changeMenu('class0Qty');
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
        ctx.changeMenu('class0');
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
            ctx.term.writeln(`\r\n${colors.boldGreen('Autopilot engaged.')}`);
            const nextSector = ctx.autopilotPath[1];
            ctx.setAutopilotStep(2);
            ctx.sendMsg({ type: ClientMsgType.Move, sector: nextSector });
            break;
        }
        case 'n':
            ctx.setAutopilotPath([]);
            ctx.setAutopilotStep(0);
            ctx.changeMenu('sector');
            showPrompt(ctx);
            break;
    }
}

export function handleJettisonConfirmInput(ctx: GameContext, line: string) {
    switch (line.toLowerCase()) {
        case 'y':
            ctx.sendMsg({ type: ClientMsgType.Jettison });
            ctx.changeMenu('sector');
            break;
        case 'n':
            ctx.changeMenu('sector');
            showPrompt(ctx);
            break;
    }
}

export function handlePlanetInput(ctx: GameContext, line: string) {
    switch (line.toLowerCase()) {
        case 't':
            ctx.changeMenu('planetTakeQty');
            showPlanetTakePrompt(ctx);
            break;
        case 'l':
            ctx.changeMenu('planetLeaveQty');
            showPlanetLeavePrompt(ctx);
            break;
        case 'd':
            ctx.sendMsg({ type: ClientMsgType.PlanetDisplay });
            break;
        case 'x':
            ctx.sendMsg({ type: ClientMsgType.DestroyPlanet });
            break;
        case 'q':
            ctx.sendMsg({ type: ClientMsgType.LeavePlanet });
            break;
    }
}

export function handlePlanetTakeQtyInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.changeMenu('sector');
        showPrompt(ctx);
        return;
    }
    const qty = parseInt(line, 10);
    if (isNaN(qty) || qty <= 0) {
        ctx.term.writeln('Enter a positive number.');
        return;
    }
    ctx.sendMsg({ type: ClientMsgType.TakeColonists, quantity: qty });
}

export function handlePlanetLeaveQtyInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.changeMenu('sector');
        showPrompt(ctx);
        return;
    }
    const qty = parseInt(line, 10);
    if (isNaN(qty) || qty <= 0) {
        ctx.term.writeln('Enter a positive number.');
        return;
    }
    ctx.sendMsg({ type: ClientMsgType.LeaveColonists, quantity: qty });
}

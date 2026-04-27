import { ClientMsgType, Menu } from '@twnr/shared';
import type { GameContext } from './types.js';
import { echoCommand } from './display.js';
import { showClass0Menu, class0MaxBuy } from './display-port.js';
import { showPlanetHelp } from './display-planet.js';
import { render } from './renderer.js';
import { COMMAND, NOTIFY, EVENT } from './messages/index.js';

export function handleClass0Input(ctx: GameContext, line: string) {
    const choose = (kind: 'drones' | 'shields' | 'holds', echoKey: keyof typeof COMMAND) => {
        echoCommand(ctx, echoKey);
        ctx.class0BuyType = kind;
        ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Class0Qty });
    };
    switch (line.toLowerCase()) {
        case 'a':
            choose('holds', 'buyHolds');
            break;
        case 'b':
            choose('drones', 'buyDrones');
            break;
        case 'c':
            choose('shields', 'buyShields');
            break;
        case 'q':
            echoCommand(ctx, 'undock');
            ctx.sendMsg({ type: ClientMsgType.Undock });
            break;
        case '?':
        default:
            showClass0Menu(ctx);
    }
}

export function handleClass0QtyInput(ctx: GameContext, line: string) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase() === 'q') {
        ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Class0 });
        return;
    }
    const kind = ctx.class0BuyType;
    if (!kind) return;
    const max = class0MaxBuy(kind, ctx);
    // Empty input = accept default (max)
    const qty = trimmed === '' ? max : parseInt(trimmed, 10);
    if (isNaN(qty) || qty < 0) {
        ctx.term.writeln('Enter a non-negative number.');
        return;
    }
    if (qty === 0) {
        ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Class0 });
        return;
    }
    // qty submission for an in-progress Buy flow — the echo already fired
    // when the user picked A/B/C from the commerce report.
    switch (kind) {
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
    switch (line.trim().toLowerCase()) {
        case '':
        case 'y': {
            ctx.term.writeln(render(NOTIFY.autopilotEngaged));
            const nextSector = ctx.autopilotPath[1];
            ctx.autopilotStep = 2;
            ctx.term.writeln(render(EVENT.autopilotWarping, { sector: nextSector }));
            ctx.sendMsg({ type: ClientMsgType.Move, sector: nextSector });
            break;
        }
        case 'n':
            ctx.autopilotPath = [];
            ctx.autopilotStep = 0;
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
            break;
    }
}

export function handleJettisonConfirmInput(ctx: GameContext, line: string) {
    switch (line.toLowerCase()) {
        case 'y':
            // Confirmation step — the <Jettison> echo fired when the user
            // pressed J at the sector menu.
            ctx.sendMsg({ type: ClientMsgType.Jettison });
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
            break;
        case '':
        case 'n':
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
            break;
    }
}

export function handlePlanetInput(ctx: GameContext, line: string) {
    switch (line.trim().toLowerCase()) {
        case 't':
            // Multi-step flow: echo at the user keystroke, gather commodity
            // + qty client-side, then ship one ClientMsg at the end.
            echoCommand(ctx, 'takeColonists');
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.PlanetTakeCommodity });
            break;
        case 'l':
            echoCommand(ctx, 'leaveColonists');
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.PlanetLeaveCommodity });
            break;
        case '':
        case 'd':
            echoCommand(ctx, 'planetDisplay');
            ctx.sendMsg({ type: ClientMsgType.PlanetDisplay });
            break;
        case 'z':
            echoCommand(ctx, 'destroyPlanet');
            ctx.sendMsg({ type: ClientMsgType.DestroyPlanet });
            break;
        case 'q':
            echoCommand(ctx, 'leavePlanet');
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
            echoCommand(ctx, 'takeColonists');
            ctx.colonistCommodity = 'fuel';
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.PlanetTakeQty });
            break;
        case 'l':
            echoCommand(ctx, 'leaveColonists');
            ctx.colonistCommodity = 'fuel';
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.PlanetLeaveQty });
            break;
        case 'q':
            echoCommand(ctx, 'leavePlanet');
            ctx.sendMsg({ type: ClientMsgType.LeavePlanet });
            break;
    }
}

export function handlePlanetTakeCommodityInput(ctx: GameContext, line: string) {
    switch (line.toLowerCase()) {
        case 'f':
            ctx.colonistCommodity = 'fuel';
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.PlanetTakeQty });
            break;
        case 'o':
            ctx.colonistCommodity = 'organics';
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.PlanetTakeQty });
            break;
        case 'e':
            ctx.colonistCommodity = 'equipment';
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.PlanetTakeQty });
            break;
        case 'q':
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Planet });
            break;
    }
}

export function handlePlanetLeaveCommodityInput(ctx: GameContext, line: string) {
    switch (line.toLowerCase()) {
        case 'f':
            ctx.colonistCommodity = 'fuel';
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.PlanetLeaveQty });
            break;
        case 'o':
            ctx.colonistCommodity = 'organics';
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.PlanetLeaveQty });
            break;
        case 'e':
            ctx.colonistCommodity = 'equipment';
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.PlanetLeaveQty });
            break;
        case 'q':
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Planet });
            break;
    }
}

function backToPlanetMenu(ctx: GameContext) {
    const target = ctx.currentSector === 1 ? Menu.PlanetEarth : Menu.Planet;
    ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: target });
}

export function handlePlanetTakeQtyInput(ctx: GameContext, line: string) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase() === 'q') {
        backToPlanetMenu(ctx);
        return;
    }
    // Empty Enter → accept default (fill free holds; server computes).
    const qty = trimmed === '' ? -1 : parseInt(trimmed, 10);
    if (qty === 0) {
        // 0 colonists = nothing to do; cancel back to the planet menu.
        backToPlanetMenu(ctx);
        return;
    }
    if (qty !== -1 && (isNaN(qty) || qty < 0)) {
        ctx.term.writeln('Enter a positive number.');
        return;
    }
    // qty submission for an in-progress take-colonists flow — the echo
    // already fired when the user pressed T at the planet menu.
    ctx.sendMsg({
        type: ClientMsgType.TakeColonists,
        quantity: qty,
        commodity: ctx.colonistCommodity ?? 'fuel',
    });
}

export function handlePlanetLeaveQtyInput(ctx: GameContext, line: string) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase() === 'q') {
        backToPlanetMenu(ctx);
        return;
    }
    // Empty Enter → accept default (leave all ship colonists; server computes).
    const qty = trimmed === '' ? -1 : parseInt(trimmed, 10);
    if (qty === 0) {
        backToPlanetMenu(ctx);
        return;
    }
    if (qty !== -1 && (isNaN(qty) || qty < 0)) {
        ctx.term.writeln('Enter a positive number.');
        return;
    }
    // qty submission for an in-progress leave-colonists flow — the echo
    // already fired when the user pressed L at the planet menu.
    ctx.sendMsg({
        type: ClientMsgType.LeaveColonists,
        quantity: qty,
        commodity: ctx.colonistCommodity ?? 'fuel',
    });
}

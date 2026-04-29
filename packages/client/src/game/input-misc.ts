import { ClientMsgType, Menu } from '@twnr/shared';
import type { GameContext } from './types.js';
import { echoCommand } from './display.js';
import { showClass0Menu } from './display-port.js';
import { showPlanetHelp } from './display-planet.js';
import { COMMAND } from './messages/index.js';

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

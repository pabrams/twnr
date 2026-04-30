import { ClientMsgType, Menu } from '@twnr/shared';
import { echoCommand } from '../display.js';
import { showTradeinPrompt } from '../display-starbase.js';
import { registerMenu, getMenuArgs } from './types.js';

registerMenu(Menu.ShipyardsTradein, {
    renderPrompt(ctx) {
        const args = getMenuArgs(ctx, Menu.ShipyardsTradein);
        showTradeinPrompt(ctx, args?.displayName ?? '', args?.price ?? 0, args?.tradein ?? 0);
    },
    input(ctx, line) {
        const args = getMenuArgs(ctx, Menu.ShipyardsTradein);
        const targetShipName = args?.target;
        if (!targetShipName) {
            ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Shipyards });
            return;
        }
        switch (line.toLowerCase()) {
            case 'y':
                echoCommand(ctx, 'buyShipTradein');
                ctx.io.sendMsg({ type: ClientMsgType.BuyShipTradein, targetShipName });
                break;
            case 'n':
                echoCommand(ctx, 'buyShipNew');
                ctx.io.sendMsg({ type: ClientMsgType.BuyShipNew, targetShipName });
                break;
            case 'q':
                echoCommand(ctx, 'shipyardsBuy');
                ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.ShipyardsBuy });
                break;
        }
    },
});

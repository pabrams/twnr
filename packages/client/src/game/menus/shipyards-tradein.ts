import { ClientMsgType, Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { echoCommand } from '../display.js';
import { showTradeinPrompt } from '../display-starbase.js';
import { registerMenu } from './types.js';

registerMenu(Menu.ShipyardsTradein, {
    enter(ctx) {
        showTradeinPrompt(
            ctx,
            ctx.shipyardsBuyDisplayName ?? '',
            ctx.shipyardsBuyPrice,
            ctx.shipyardsBuyTradein,
        );
    },
    input(ctx, line) {
        const targetShipName = ctx.shipyardsBuyTarget;
        if (!targetShipName) {
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Shipyards });
            return;
        }
        switch (line.toLowerCase()) {
            case 'y':
                echoCommand(ctx, 'buyShipTradein');
                ctx.sendMsg({ type: ClientMsgType.BuyShipTradein, targetShipName });
                break;
            case 'n':
                echoCommand(ctx, 'buyShipNew');
                ctx.sendMsg({ type: ClientMsgType.BuyShipNew, targetShipName });
                break;
            case 'q':
                echoCommand(ctx, 'shipyardsBuy');
                ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.ShipyardsBuy });
                break;
            default:
                ctx.term.write(render('[c]Trade in?[/c] (Y/N/Q) '));
        }
    },
});

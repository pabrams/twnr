import { ClientMsgType, Menu } from '@twnr/shared';
import { echoCommand } from '../display.js';
import { showShipyardsMenu, showShipyardsPrompt, showShipyardsHelp } from '../display-starbase.js';
import { registerMenu } from './types.js';

registerMenu(Menu.Shipyards, {
    enter: showShipyardsMenu,
    input(ctx, line) {
        switch (line.toLowerCase()) {
            case 'b':
                echoCommand(ctx, 'shipyardsBuy');
                ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.ShipyardsBuy });
                break;
            case 'e':
                echoCommand(ctx, 'shipyardsExamine');
                ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.ShipyardsExamine });
                break;
            case 'p':
                echoCommand(ctx, 'shipyardsEquipment');
                ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.ShipyardsClass0 });
                break;
            case '?':
                showShipyardsHelp(ctx);
                break;
            case 'q':
                echoCommand(ctx, 'starbase');
                ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Starbase });
                break;
            default:
                showShipyardsPrompt(ctx);
        }
    },
});

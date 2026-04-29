import { ClientMsgType, Menu } from '@twnr/shared';
import { echoCommand } from '../display.js';
import { showPlanetLeaveCommodityMenu } from '../display-planet.js';
import { registerMenu } from './types.js';

registerMenu(Menu.PlanetLeaveCommodity, {
    enter: showPlanetLeaveCommodityMenu,
    input(ctx, line) {
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
                echoCommand(ctx, 'planetLeaveCommodityBack');
                ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Planet });
                break;
        }
    },
});

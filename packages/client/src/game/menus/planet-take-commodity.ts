import { ClientMsgType, Menu } from '@twnr/shared';
import { echoCommand } from '../display.js';
import { showPlanetTakeCommodityMenu } from '../display-planet.js';
import { registerMenu } from './types.js';

registerMenu(Menu.PlanetTakeCommodity, {
    enter: showPlanetTakeCommodityMenu,
    input(ctx, line) {
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
                echoCommand(ctx, 'planetTakeCommodityBack');
                ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Planet });
                break;
        }
    },
});

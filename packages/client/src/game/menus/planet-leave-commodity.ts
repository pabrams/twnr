import { ClientMsgType, Menu } from '@twnr/shared';
import { echoCommand } from '../display.js';
import { showPlanetLeaveCommodityMenu } from '../display-planet.js';
import { registerMenu, setMenuArgs } from './types.js';

registerMenu(Menu.PlanetLeaveCommodity, {
    renderPrompt: showPlanetLeaveCommodityMenu,
    input(ctx, line) {
        switch (line.toLowerCase()) {
            case 'f':
                setMenuArgs(ctx, { menu: Menu.PlanetLeaveQty, commodity: 'fuel' });
                ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.PlanetLeaveQty });
                break;
            case 'o':
                setMenuArgs(ctx, { menu: Menu.PlanetLeaveQty, commodity: 'organics' });
                ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.PlanetLeaveQty });
                break;
            case 'e':
                setMenuArgs(ctx, { menu: Menu.PlanetLeaveQty, commodity: 'equipment' });
                ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.PlanetLeaveQty });
                break;
            case 'q':
                echoCommand(ctx, 'planetLeaveCommodityBack');
                ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Planet });
                break;
        }
    },
});

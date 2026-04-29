import { ClientMsgType, Menu } from '@twnr/shared';
import { echoCommand } from '../display.js';
import { showPlanetTakeCommodityMenu } from '../display-planet.js';
import { registerMenu, setMenuArgs } from './types.js';

registerMenu(Menu.PlanetTakeCommodity, {
    renderPrompt: showPlanetTakeCommodityMenu,
    input(ctx, line) {
        switch (line.toLowerCase()) {
            case 'f':
                setMenuArgs(ctx, { menu: Menu.PlanetTakeQty, commodity: 'fuel' });
                ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.PlanetTakeQty });
                break;
            case 'o':
                setMenuArgs(ctx, { menu: Menu.PlanetTakeQty, commodity: 'organics' });
                ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.PlanetTakeQty });
                break;
            case 'e':
                setMenuArgs(ctx, { menu: Menu.PlanetTakeQty, commodity: 'equipment' });
                ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.PlanetTakeQty });
                break;
            case 'q':
                echoCommand(ctx, 'planetTakeCommodityBack');
                ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Planet });
                break;
        }
    },
});

import { ClientMsgType, Menu } from '@twnr/shared';
import { echoCommand } from '../display.js';
import { showPlanetMenuOptions } from '../display-planet.js';
import { registerMenu } from './types.js';

registerMenu(Menu.PlanetEarth, {
    enter: showPlanetMenuOptions,
    input(ctx, line) {
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
    },
});

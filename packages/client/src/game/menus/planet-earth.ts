import { ClientMsgType, Menu } from '@twnr/shared';
import { echoCommand } from '../display.js';
import { showPlanetMenuOptions } from '../display-planet.js';
import { registerMenu, setMenuArgs } from './types.js';

registerMenu(Menu.PlanetEarth, {
    renderPrompt: showPlanetMenuOptions,
    input(ctx, line) {
        switch (line.toLowerCase()) {
            case 't':
                echoCommand(ctx, 'takeColonists');
                setMenuArgs(ctx, { menu: Menu.PlanetTakeQty, commodity: 'fuel' });
                ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.PlanetTakeQty });
                break;
            case 'l':
                echoCommand(ctx, 'leaveColonists');
                setMenuArgs(ctx, { menu: Menu.PlanetLeaveQty, commodity: 'fuel' });
                ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.PlanetLeaveQty });
                break;
            case 'q':
                echoCommand(ctx, 'leavePlanet');
                ctx.io.sendMsg({ type: ClientMsgType.LeavePlanet });
                break;
        }
    },
});

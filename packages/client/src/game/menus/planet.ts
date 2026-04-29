import { ClientMsgType, Menu } from '@twnr/shared';
import { echoCommand } from '../display.js';
import { showPlanetMenuOptions, showPlanetHelp } from '../display-planet.js';
import { registerMenu } from './types.js';

registerMenu(Menu.Planet, {
    enter: showPlanetMenuOptions,
    input(ctx, line) {
        switch (line.trim().toLowerCase()) {
            case 't':
                // Multi-step flow: echo at the user keystroke, gather
                // commodity + qty client-side, then ship one ClientMsg at
                // the end.
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
    },
});

import { ClientMsgType, Menu } from '@twnr/shared';
import { echoCommand } from '../display.js';
import {
    showComputerHelp,
    showComputerPrompt,
    showCurrentShipSpecs,
    showTraderList,
} from '../display-computer.js';
import { registerMenu } from './types.js';

registerMenu(Menu.Computer, {
    renderPrompt: showComputerPrompt,
    input(ctx, line) {
        switch (line.toLowerCase()) {
            case 'k':
                ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.KnownUniverse });
                break;
            case 'l':
                showTraderList(ctx);
                break;
            case 'c':
                ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.ShipCatalog });
                break;
            case 'j':
                ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.PlanetSpecs });
                break;
            case ';':
                showCurrentShipSpecs(ctx);
                break;
            case 'y':
                echoCommand(ctx, 'listPlanets');
                ctx.io.sendMsg({ type: ClientMsgType.ListPlanets });
                break;
            case '?':
                showComputerHelp(ctx);
                break;
            case 'q':
                echoCommand(ctx, 'computerBack');
                ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
                break;
        }
    },
});

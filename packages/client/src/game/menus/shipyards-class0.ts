import { ClientMsgType, Menu } from '@twnr/shared';
import { echoCommand } from '../display.js';
import { showShipyardsClass0Menu } from '../display-starbase.js';
import { showClass0Menu } from '../display-port.js';
import { registerMenu, setMenuArgs } from './types.js';

registerMenu(Menu.ShipyardsClass0, {
    renderPrompt: showShipyardsClass0Menu,
    input(ctx, line) {
        const choose = (
            kind: 'drones' | 'shields' | 'holds',
            echoKey: 'buyHolds' | 'buyDrones' | 'buyShields',
        ) => {
            echoCommand(ctx, echoKey);
            setMenuArgs(ctx, { menu: Menu.ShipyardsClass0Qty, kind });
            ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.ShipyardsClass0Qty });
        };
        switch (line.toLowerCase()) {
            case 'a':
                choose('holds', 'buyHolds');
                break;
            case 'b':
                choose('drones', 'buyDrones');
                break;
            case 'c':
                choose('shields', 'buyShields');
                break;
            case 'q':
                echoCommand(ctx, 'shipyards');
                ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Shipyards });
                break;
            case '?':
            default:
                // showClass0Menu is async (loads class-0 prices on first call);
                // intentionally fire-and-forget.
                void showClass0Menu(ctx);
        }
    },
});

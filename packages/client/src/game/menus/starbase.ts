import { ClientMsgType, Menu } from '@twnr/shared';
import { echoCommand } from '../display.js';
import { showStarbaseMenu, showStarbaseHelp } from '../display-starbase.js';
import { registerMenu } from './types.js';

registerMenu(Menu.Starbase, {
    renderPrompt: showStarbaseMenu,
    input(ctx, line) {
        switch (line.toLowerCase()) {
            case 's':
                echoCommand(ctx, 'shipyards');
                ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Shipyards });
                break;
            case 'h':
                echoCommand(ctx, 'hardwareStoreInfo');
                ctx.io.sendMsg({ type: ClientMsgType.HardwareStoreInfo });
                break;
            case '?':
                showStarbaseHelp(ctx);
                break;
            case 'q':
                echoCommand(ctx, 'leaveStarbase');
                ctx.io.sendMsg({ type: ClientMsgType.LeaveStarbase });
                break;
        }
    },
});

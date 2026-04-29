import { ClientMsgType, Menu } from '@twnr/shared';
import { echoCommand, showPortMenu } from '../display.js';
import { registerMenu } from './types.js';

registerMenu(Menu.Port, {
    enter: showPortMenu,
    input(ctx, line) {
        switch (line.toLowerCase()) {
            case 't':
                // Trade ports (class 1-8). Class 9 is the Starbase, which uses S.
                if (ctx.currentPort?.class !== 9) {
                    echoCommand(ctx, 'dock');
                    ctx.sendMsg({ type: ClientMsgType.Dock });
                }
                break;
            case 's':
                // Starbase entry. Other classes ignore S here.
                if (ctx.currentPort?.class === 9) {
                    echoCommand(ctx, 'dockStarbase');
                    ctx.sendMsg({ type: ClientMsgType.DockStarbase });
                }
                break;
            case 'q':
                echoCommand(ctx, 'portBack');
                ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
                break;
        }
    },
});

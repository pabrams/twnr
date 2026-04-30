import { ClientMsgType, Menu } from '@twnr/shared';
import { echoCommand } from '../display.js';
import { showClass0Menu } from '../display-port.js';
import { COMMAND } from '../messages/index.js';
import { registerMenu, setMenuArgs } from './types.js';

registerMenu(Menu.Class0, {
    renderPrompt(ctx) {
        // showClass0Menu is async (loads class-0 prices); renderPrompt
        // signature is sync, so the promise is intentionally unawaited.  TODO: what?
        void showClass0Menu(ctx);
    },
    input(ctx, line) {
        const choose = (kind: 'drones' | 'shields' | 'holds', echoKey: keyof typeof COMMAND) => {
            echoCommand(ctx, echoKey);
            setMenuArgs(ctx, { menu: Menu.Class0Qty, kind });
            ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Class0Qty });
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
                echoCommand(ctx, 'undock');
                ctx.io.sendMsg({ type: ClientMsgType.Undock });
                break;
            case '?':
            default:
                void showClass0Menu(ctx);
        }
    },
});

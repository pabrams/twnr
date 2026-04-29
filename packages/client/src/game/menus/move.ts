import { ClientMsgType, Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { echoCommand, showMoveMenu, hideMoveMenuOverlay } from '../display.js';
import { NOTIFY } from '../messages/index.js';
import { registerMenu } from './types.js';

registerMenu(Menu.Move, {
    enter: showMoveMenu,
    input(ctx, line) {
        const cmd = line.trim();
        if (cmd === '') {
            showMoveMenu(ctx);
            return;
        }
        if (cmd.toLowerCase() === 'q') {
            hideMoveMenuOverlay(ctx);
            echoCommand(ctx, 'moveMenuBack');
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
            return;
        }
        const warps = ctx.currentWarps.slice(0, 6);
        const idx = parseInt(cmd, 10) - 1;
        if (idx >= 0 && idx < warps.length) {
            hideMoveMenuOverlay(ctx);
            const sector = warps[idx].sector;
            echoCommand(ctx, 'move', { sector });
            ctx.sendMsg({ type: ClientMsgType.Move, sector });
            return;
        }
        ctx.term.writeln(render(NOTIFY.invalidSelection));
        showMoveMenu(ctx);
    },
});

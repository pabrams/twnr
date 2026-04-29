import { ClientMsgType, Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { echoCommand, showMoveMenu, hideMoveMenuOverlay } from '../display.js';
import { NOTIFY } from '../messages/index.js';
import { registerMenu } from './types.js';

registerMenu(Menu.Move, {
    renderPrompt: showMoveMenu,
    input(ctx, line) {
        const cmd = line.trim();
        if (cmd === '') {
            showMoveMenu(ctx);
            return;
        }
        if (cmd.toLowerCase() === 'q') {
            hideMoveMenuOverlay(ctx);
            echoCommand(ctx, 'moveMenuBack');
            ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
            return;
        }
        const warps = ctx.world.currentWarps.slice(0, 6);
        const idx = parseInt(cmd, 10) - 1;
        if (idx >= 0 && idx < warps.length) {
            hideMoveMenuOverlay(ctx);
            const sector = warps[idx].sector;
            echoCommand(ctx, 'move', { sector });
            ctx.io.sendMsg({ type: ClientMsgType.Move, sector });
            return;
        }
        ctx.io.term.writeln(render(NOTIFY.invalidSelection));
        showMoveMenu(ctx);
    },
});

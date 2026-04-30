import { ClientMsgType, Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { COMPUTER } from '../messages/index.js';
import { echoCommand } from '../display.js';
import { registerMenu } from './types.js';

registerMenu(Menu.HyperspaceJumpTarget, {
    renderPrompt(ctx) {
        ctx.io.term.write(render(COMPUTER.hyperspaceJumpTargetPrompt));
    },
    input(ctx, line) {
        if (line.toLowerCase() === 'q') {
            echoCommand(ctx, 'hyperspaceJumpTargetBack');
            ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Computer });
            return;
        }
        const sector = parseInt(line, 10);
        if (isNaN(sector) || sector <= 0) return;
        echoCommand(ctx, 'hyperspaceJump');
        ctx.io.sendMsg({ type: ClientMsgType.HyperspaceJump, targetSector: sector });
    },
});

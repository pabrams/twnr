import { ClientMsgType, Menu } from '@twnr/shared';
import { echoCommand } from '../display.js';
import { registerMenu } from './types.js';

registerMenu(Menu.HyperspaceJumpTarget, {
    input(ctx, line) {
        if (line.toLowerCase() === 'q') {
            echoCommand(ctx, 'hyperspaceJumpTargetBack');
            ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Computer });
            return;
        }
        const sector = parseInt(line, 10);
        if (isNaN(sector) || sector <= 0) {
            ctx.io.term.writeln('Enter a valid sector number.');
            return;
        }
        echoCommand(ctx, 'hyperspaceJump');
        ctx.io.sendMsg({ type: ClientMsgType.HyperspaceJump, targetSector: sector });
    },
});

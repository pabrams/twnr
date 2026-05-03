import { ClientMsgType, Menu } from '@twnr/shared';
import { echoCommand } from '../display.js';
import { registerMenu } from './types.js';

registerMenu(Menu.MineDisruptorTarget, {
    renderPrompt(ctx) {
        ctx.io.term.write('Mine disruptor — adjacent target sector? (Q to cancel) ');
    },
    input(ctx, line) {
        const trimmed = line.trim();
        if (trimmed.toLowerCase() === 'q' || trimmed === '') {
            echoCommand(ctx, 'jettisonConfirmBack');
            ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
            return;
        }
        const target = parseInt(trimmed, 10);
        if (isNaN(target) || target <= 0) {
            ctx.io.term.writeln('Enter a sector number (Q to cancel).');
            return;
        }
        ctx.io.sendMsg({ type: ClientMsgType.MineDisruptor, targetSector: target });
    },
});

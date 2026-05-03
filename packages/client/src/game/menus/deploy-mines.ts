import { ClientMsgType, Menu } from '@twnr/shared';
import { echoCommand } from '../display.js';
import { registerMenu, setMenuArgs } from './types.js';

registerMenu(Menu.DeployMines, {
    renderPrompt(ctx) {
        ctx.io.term.writeln('');
        ctx.io.term.writeln('Deploy mines:');
        ctx.io.term.writeln('  P - Proximity Mines');
        ctx.io.term.writeln('  S - Seeker Mines');
        ctx.io.term.writeln('  Q - Back');
        ctx.io.term.write('Mine type? ');
    },
    input(ctx, line) {
        const cmd = line.trim().toLowerCase();
        if (cmd === 'q') {
            echoCommand(ctx, 'jettisonConfirmBack');
            ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
            return;
        }
        if (cmd === 'p' || cmd === 's') {
            const mineType = cmd === 'p' ? 'proximity' : 'seeker';
            setMenuArgs(ctx, { menu: Menu.DeployMinesQty, mineType });
            ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.DeployMinesQty });
        }
    },
});

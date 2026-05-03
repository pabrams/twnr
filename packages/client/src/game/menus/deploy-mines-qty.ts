import { ClientMsgType, Menu } from '@twnr/shared';
import { echoCommand } from '../display.js';
import { registerMenu, getMenuArgs } from './types.js';

registerMenu(Menu.DeployMinesQty, {
    renderPrompt(ctx) {
        const args = getMenuArgs(ctx, Menu.DeployMinesQty);
        const label = args?.mineType === 'seeker' ? 'Seeker' : 'Proximity';
        ctx.io.term.write(`How many ${label} mines to deploy? (Q to cancel) `);
    },
    input(ctx, line) {
        const trimmed = line.trim();
        if (trimmed.toLowerCase() === 'q' || trimmed === '0' || trimmed === '') {
            echoCommand(ctx, 'jettisonConfirmBack');
            ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
            return;
        }
        const qty = parseInt(trimmed, 10);
        if (isNaN(qty) || qty <= 0) {
            ctx.io.term.writeln('Enter a positive number (Q to cancel).');
            return;
        }
        const args = getMenuArgs(ctx, Menu.DeployMinesQty);
        if (!args) {
            ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
            return;
        }
        ctx.io.sendMsg({
            type: ClientMsgType.DeployMine,
            mineType: args.mineType,
            quantity: qty,
        });
    },
});

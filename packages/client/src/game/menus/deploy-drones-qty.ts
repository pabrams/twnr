import { ClientMsgType, Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { EVENT } from '../messages/index.js';
import { echoCommand } from '../display.js';
import { registerMenu, getMenuArgs } from './types.js';

registerMenu(Menu.DeployDronesQty, {
    renderPrompt(ctx) {
        const args = getMenuArgs(ctx, Menu.DeployDronesQty);
        if (!args) return;
        ctx.io.term.write(render(EVENT.deployDronesPrompt, { minInSector: args.minInSector }));
    },
    input(ctx, line) {
        const trimmed = line.trim();
        if (trimmed.toLowerCase() === 'q') {
            echoCommand(ctx, 'deployDronesQtyBack');
            ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
            return;
        }
        if (trimmed === '') {
            ctx.io.sendMsg({ type: ClientMsgType.DeployDrones, quantity: -1 });
            return;
        }
        const qty = parseInt(trimmed, 10);
        if (isNaN(qty) || qty < 0) {
            ctx.io.term.writeln('Enter a non-negative number (0 to retrieve all).');
            return;
        }
        ctx.io.sendMsg({ type: ClientMsgType.DeployDrones, quantity: qty });
    },
});

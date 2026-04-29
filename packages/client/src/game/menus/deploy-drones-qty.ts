import { ClientMsgType, Menu } from '@twnr/shared';
import { echoCommand } from '../display.js';
import { registerMenu } from './types.js';

// DeployDronesQty has no `renderPrompt`: prompt is rendered by the
// DeployDronesInfoResult handler in connection.ts.
registerMenu(Menu.DeployDronesQty, {
    input(ctx, line) {
        const trimmed = line.trim();
        if (trimmed.toLowerCase() === 'q') {
            echoCommand(ctx, 'deployDronesQtyBack');
            ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
            return;
        }
        // Empty Enter → accept default (server computes it). The <Deploy
        // Drones> echo fired at D-press in input.ts; this is the qty
        // submission step.
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

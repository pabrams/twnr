import { ClientMsgType, Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { NOTIFY } from '../messages/index.js';
import { echoCommand } from '../display.js';
import { registerMenu } from './types.js';

// Attack has no `renderPrompt`: AttackMenuResult drives the display via
// showAttackMenu in connection.ts.
registerMenu(Menu.Attack, {
    input(ctx, line) {
        if (line.toLowerCase() === 'q') {
            echoCommand(ctx, 'attackBack');
            ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
            return;
        }
        const idx = parseInt(line, 10) - 1;
        if (idx >= 0 && idx < ctx.world.sectorPlayers.length) {
            ctx.encounter.attackTarget = ctx.world.sectorPlayers[idx].id;
            ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.AttackDrones });
        } else {
            ctx.io.term.writeln(render(NOTIFY.invalidSelection));
        }
    },
});

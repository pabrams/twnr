import { ClientMsgType, Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { NOTIFY } from '../messages/index.js';
import { echoCommand } from '../display.js';
import { showAttackMenu, showAttackPrompt } from '../display-combat.js';
import { registerMenu } from './types.js';

registerMenu(Menu.Attack, {
    renderPrompt: showAttackPrompt,
    input(ctx, line) {
        const cmd = line.toLowerCase();
        if (cmd === 'q') {
            echoCommand(ctx, 'attackBack');
            ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
            return;
        }
        if (cmd === '?') {
            showAttackMenu(ctx);
            return;
        }
        const idx = parseInt(line, 10) - 1;
        if (idx >= 0 && idx < ctx.world.sectorPlayers.length) {
            ctx.encounter.attackTarget = ctx.world.sectorPlayers[idx].id;
            ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.AttackDrones });
        } else {
            ctx.io.term.writeln(render(NOTIFY.invalidSelection));
            showAttackPrompt(ctx);
        }
    },
});

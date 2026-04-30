import { ClientMsgType, Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { COMMON } from '../messages/index.js';
import { echoCommand } from '../display.js';
import { registerMenu } from './types.js';

registerMenu(Menu.DroneEncounter, {
    input(ctx, line) {
        switch (line.toLowerCase()) {
            case 'a':
                echoCommand(ctx, 'attackSectorDrones');
                ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.DroneAttackQty });
                break;
            case 'r':
                echoCommand(ctx, 'retreatFromDrones');
                ctx.io.sendMsg({ type: ClientMsgType.RetreatFromDrones });
                break;
            default:
                ctx.io.term.writeln(render(COMMON.menuRow, { key: 'A', text: 'Attack' }));
                ctx.io.term.writeln(render(COMMON.menuRow, { key: 'R', text: 'Retreat' }));
        }
    },
});

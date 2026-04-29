import { ClientMsgType, Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { COMMON } from '../messages/index.js';
import { echoCommand } from '../display.js';
import { registerMenu } from './types.js';

// DroneEncounter has no `enter`: the encounter banner is rendered by the
// DroneEncounterResult handler in connection.ts.
registerMenu(Menu.DroneEncounter, {
    input(ctx, line) {
        switch (line.toLowerCase()) {
            case 'a':
                // Multi-step: qty prompt next; the AttackSectorDrones
                // ClientMsg is the qty submission, no echo at that step.
                echoCommand(ctx, 'attackSectorDrones');
                ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.DroneAttackQty });
                break;
            case 'r':
                echoCommand(ctx, 'retreatFromDrones');
                ctx.sendMsg({ type: ClientMsgType.RetreatFromDrones });
                break;
            default:
                ctx.term.writeln(render(COMMON.menuRow, { key: 'A', text: 'Attack' }));
                ctx.term.writeln(render(COMMON.menuRow, { key: 'R', text: 'Retreat' }));
        }
    },
});

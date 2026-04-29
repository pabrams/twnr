import { ClientMsgType, Menu } from '@twnr/shared';
import { showAttackDronesPrompt } from '../display-combat.js';
import { echoCommand } from '../display.js';
import { registerMenu } from './types.js';

registerMenu(Menu.AttackDrones, {
    enter: showAttackDronesPrompt,
    input(ctx, line) {
        if (line.toLowerCase() === 'q') {
            echoCommand(ctx, 'attackDronesBack');
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
            return;
        }
        const qty = parseInt(line, 10);
        if (isNaN(qty) || qty <= 0) {
            ctx.term.writeln('Enter a positive number.');
            return;
        }
        ctx.sendMsg({
            type: ClientMsgType.AttackShip,
            targetPlayerId: ctx.attackTarget!,
            drones: qty,
        });
    },
});

import { ClientMsgType, Menu } from '@twnr/shared';
import { showAttackDronesPrompt } from '../display-combat.js';
import { echoCommand } from '../display.js';
import { registerMenu } from './types.js';

registerMenu(Menu.AttackDrones, {
    renderPrompt: showAttackDronesPrompt,
    input(ctx, line) {
        if (line.toLowerCase() === 'q') {
            echoCommand(ctx, 'attackDronesBack');
            ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
            return;
        }
        const qty = parseInt(line, 10);
        if (isNaN(qty) || qty <= 0) {
            ctx.io.term.writeln('Enter a positive number.');
            showAttackDronesPrompt(ctx);
            return;
        }
        ctx.io.sendMsg({
            type: ClientMsgType.AttackShip,
            targetPlayerId: ctx.encounter.attackTarget!,
            drones: qty,
        });
    },
});

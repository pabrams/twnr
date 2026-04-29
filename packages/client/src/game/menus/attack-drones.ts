import { ClientMsgType, Menu } from '@twnr/shared';
import { showAttackDronesPrompt } from '../display-combat.js';
import { registerMenu } from './types.js';

registerMenu(Menu.AttackDrones, {
    enter: showAttackDronesPrompt,
    input(ctx, line) {
        if (line.toLowerCase() === 'q') {
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
            return;
        }
        const qty = parseInt(line, 10);
        if (isNaN(qty) || qty <= 0) {
            ctx.term.writeln('Enter a positive number.');
            return;
        }
        // qty submission for an in-progress Attack flow — the <Attack>
        // echo already fired when the player pressed A at the sector menu.
        ctx.sendMsg({
            type: ClientMsgType.AttackShip,
            targetPlayerId: ctx.attackTarget!,
            drones: qty,
        });
    },
});

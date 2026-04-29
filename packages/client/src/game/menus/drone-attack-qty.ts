import { ClientMsgType, Menu } from '@twnr/shared';
import { showDroneAttackQtyPrompt } from '../display-combat.js';
import { echoCommand } from '../display.js';
import { registerMenu } from './types.js';

registerMenu(Menu.DroneAttackQty, {
    renderPrompt: showDroneAttackQtyPrompt,
    input(ctx, line) {
        if (line.toLowerCase() === 'q') {
            echoCommand(ctx, 'droneAttackQtyBack');
            ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.DroneEncounter });
            return;
        }
        const qty = parseInt(line, 10);
        if (isNaN(qty) || qty <= 0) {
            ctx.io.term.writeln('Enter a positive number.');
            return;
        }
        // qty submission — the echo fired at A-press in DroneEncounter.
        ctx.io.sendMsg({ type: ClientMsgType.AttackSectorDrones, drones: qty });
    },
});

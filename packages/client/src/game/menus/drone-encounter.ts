import { ClientMsgType, Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { COMBAT } from '../messages/index.js';
import { echoCommand } from '../display.js';
import { showDroneEncounterPrompt } from '../display-combat.js';
import { registerMenu } from './types.js';
import { askNumber } from './prompts.js';

registerMenu(Menu.DroneEncounter, {
    renderPrompt: showDroneEncounterPrompt,
    async input(ctx, line) {
        const k = line.toLowerCase();
        if (k === 'a') {
            echoCommand(ctx, 'attackSectorDrones');
            // askNumber inline — droneAttackQty menu is gone.
            const qty = await askNumber(ctx, render(COMBAT.droneAttackQtyPrompt), { min: 1 });
            if (qty === null) return;
            ctx.io.sendMsg({ type: ClientMsgType.AttackSectorDrones, drones: qty });
            return;
        }
        if (k === 'r') {
            echoCommand(ctx, 'retreatFromDrones');
            ctx.io.sendMsg({ type: ClientMsgType.RetreatFromDrones });
            return;
        }
    },
});

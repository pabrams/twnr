import { ClientTag, Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { COMBAT } from '../messages/index.js';
import { echoCommand } from '../display.js';
import { showDroneEncounterPrompt } from '../display-combat.js';
import { registerMenu } from './types.js';
import { askNumber } from './prompts.js';

registerMenu(Menu.DroneEncounter, {
    renderPrompt: showDroneEncounterPrompt,
    acceptsKey: (key) => key === 'a' || key === 'r',
    async input(ctx, line) {
        if (line === 'a') {
            echoCommand(ctx, 'attackSectorDrones');
            const qty = await askNumber(ctx, render(COMBAT.droneAttackQtyPrompt), { min: 1 });
            if (qty === null) return;
            ctx.io.sendMsg({ type: ClientTag.AttackSectorDrones, drones: qty });
            return;
        }
        if (line === 'r') {
            echoCommand(ctx, 'retreatFromDrones');
            ctx.io.sendMsg({ type: ClientTag.RetreatFromDrones });
        }
    },
});

import { ClientMsgType, Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { COMBAT } from '../messages/index.js';
import { echoCommand } from '../display.js';
import { showDroneEncounterPrompt } from '../display-combat.js';
import { registerMenu, registerMenuRoutine } from './types.js';
import { askNumber } from './prompts.js';

registerMenu(Menu.DroneEncounter, {
    renderPrompt: showDroneEncounterPrompt,
});

registerMenuRoutine(Menu.DroneEncounter, 'attack_encounter', async (ctx) => {
    echoCommand(ctx, 'attackSectorDrones');
    const qty = await askNumber(ctx, render(COMBAT.droneAttackQtyPrompt), { min: 1 });
    if (qty === null) return;
    ctx.io.sendMsg({ type: ClientMsgType.AttackSectorDrones, drones: qty });
});

registerMenuRoutine(Menu.DroneEncounter, 'retreat', (ctx) => {
    echoCommand(ctx, 'retreatFromDrones');
    ctx.io.sendMsg({ type: ClientMsgType.RetreatFromDrones });
});

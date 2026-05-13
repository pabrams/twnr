import { ClientTag } from '@twnr/shared';
import { render } from '../renderer.js';
import { COMBAT } from '../messages/index.js';
import { echoCommand } from '../display.js';
import { registerRoutine } from './types.js';
import { askNumber } from './prompts.js';

registerRoutine('attack_sector_drones', async (ctx) => {
    echoCommand(ctx, 'attackSectorDrones');
    const qty = await askNumber(ctx, render(COMBAT.droneAttackQtyPrompt), { min: 1 });
    if (qty === null) return;
    ctx.io.sendMsg({ type: ClientTag.AttackSectorDrones, drones: qty });
});

registerRoutine('retreat_from_drones', (ctx) => {
    echoCommand(ctx, 'retreatFromDrones');
    ctx.io.sendMsg({ type: ClientTag.RetreatFromDrones });
});

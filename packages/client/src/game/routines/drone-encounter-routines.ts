import { Commands, command } from '@twnr/shared';
import { render } from '../renderer.js';
import { COMBAT } from '../messages/index.js';
import { echoCommand } from '../display.js';
import { registerRoutine } from './types.js';
import { askNumber } from './prompts.js';

registerRoutine('attackSectorDrones', async (ctx) => {
    echoCommand(ctx, 'attackSectorDrones');
    const defaultQty = Math.min(ctx.ship.shipDrones, ctx.ship.shipMaxDroneAttack);
    const qty = await askNumber(ctx, render(COMBAT.droneAttackQtyPrompt), {
        min: 0,
        defaultValue: defaultQty,
    });
    if (qty === null) return;
    ctx.io.sendMsg(command(Commands.AttackSectorDrones, { drones: qty }));
});

registerRoutine('retreatFromDrones', (ctx) => {
    echoCommand(ctx, 'retreatFromDrones');
    ctx.io.sendMsg(command(Commands.RetreatFromDrones, {}));
});

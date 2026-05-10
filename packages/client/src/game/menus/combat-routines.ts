import { ClientMsgType } from '@twnr/shared';
import { render } from '../renderer.js';
import { COMBAT, NOTIFY } from '../messages/index.js';
import { registerRoutine } from './types.js';
import { askNumber } from './prompts.js';

registerRoutine('select_target', async (ctx, line) => {
    const idx = parseInt(line, 10) - 1;
    if (idx < 0 || idx >= ctx.world.sectorPlayers.length) {
        ctx.io.term.writeln(render(NOTIFY.invalidSelection));
        return;
    }
    const targetId = ctx.world.sectorPlayers[idx].id;
    ctx.encounter.attackTarget = targetId;
    const drones = await askNumber(ctx, render(COMBAT.attackQtyPrompt), { min: 1 });
    if (drones === null) {
        ctx.encounter.attackTarget = null;
        return;
    }
    ctx.io.sendMsg({ type: ClientMsgType.AttackShip, targetPlayerId: targetId, drones });
});

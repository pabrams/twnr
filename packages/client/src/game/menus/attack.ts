import { Menu } from '@twnr/shared';
import { showAttackPrompt } from '../display-combat.js';
import { registerMenu, getRoutine } from './types.js';

registerMenu(Menu.Attack, {
    renderPrompt: showAttackPrompt,
    acceptsKey: (key) => key === 'q' || /^\d$/.test(key),
    input(ctx, line) {
        if (line === '') return;
        if (line === 'q') return getRoutine(ctx.world.mode, 'back')?.(ctx, line);
        if (/^\d+$/.test(line)) return getRoutine(ctx.world.mode, 'select_target')?.(ctx, line);
    },
});

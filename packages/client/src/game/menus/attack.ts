import { Menu } from '@twnr/shared';
import { showAttackPrompt } from '../display-combat.js';
import { registerMenu } from './types.js';

// Attack menu — fully migrated. Routines in combat-routines.ts; back in
// common-routines.ts. Number keys are dispatched via the `<number>`
// pattern to the `select_target` routine.
registerMenu(Menu.Attack, {
    renderPrompt: showAttackPrompt,
});

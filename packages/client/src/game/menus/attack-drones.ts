import { Menu } from '@twnr/shared';
import { showAttackDronesPrompt } from '../display-combat.js';
import { registerMenu } from './types.js';

// AttackDrones menu — single-prompt menu (qty for the attack). Migrated:
// menu-scoped `enter_quantity` routine in combat-routines.ts handles the
// numeric input; back is in common-routines.ts. When the qty-prompt
// collapse lands this menu disappears entirely (the `select_target`
// routine will askNumber inline before sending AttackShip).
registerMenu(Menu.AttackDrones, {
    renderPrompt: showAttackDronesPrompt,
});

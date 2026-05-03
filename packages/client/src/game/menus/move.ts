import { Menu } from '@twnr/shared';
import { showMoveMenu } from '../display.js';
import { registerMenu } from './types.js';

// Move menu — fully migrated. Routines for select_warp_1..6 and the
// menu-scoped back override are in move-routines.ts. Empty Enter
// re-renders the menu via the dispatcher's default <enter> behavior.
registerMenu(Menu.Move, {
    renderPrompt: showMoveMenu,
});

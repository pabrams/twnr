import { Menu } from '@twnr/shared';
import { showComputerPrompt } from '../display-computer.js';
import { registerMenu } from './types.js';

// Computer menu — fully migrated. Routines in computer-routines.ts;
// back / help_menu in common-routines.ts.
registerMenu(Menu.Computer, {
    renderPrompt: showComputerPrompt,
});

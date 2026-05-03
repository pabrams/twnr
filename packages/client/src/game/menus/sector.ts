import { Menu } from '@twnr/shared';
import { showPrompt } from '../display.js';
import { registerMenu } from './types.js';

/**
 * Sector menu — fully migrated to the routine-registry pattern. All
 * keystroke dispatch goes through `dispatchByRegistry` in input.ts.
 * Routines are registered in `sector-routines.ts` (sector-specific) and
 * `common-routines.ts` (back / help_menu / list_deployed_drones).
 */
registerMenu(Menu.Sector, {
    renderPrompt: showPrompt,
});

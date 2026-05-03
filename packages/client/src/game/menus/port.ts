import { Menu } from '@twnr/shared';
import { showPortMenu } from '../display.js';
import { registerMenu } from './types.js';

// Port menu — fully migrated. Routines in port-routines.ts; back in
// common-routines.ts.
registerMenu(Menu.Port, {
    renderPrompt: showPortMenu,
});

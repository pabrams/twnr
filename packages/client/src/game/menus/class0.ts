import { Menu } from '@twnr/shared';
import { showClass0Menu } from '../display-port.js';
import { registerMenu } from './types.js';

// Class-0 in-port trade menu — fully migrated. The choose_* routines and
// the leave_port (Q → Undock) routine live in shipyards-routines.ts
// since they're shared with the shipyards class-0 menu.
registerMenu(Menu.Class0, {
    renderPrompt(ctx) {
        // showClass0Menu is async (fetches class-0 prices); the promise
        // is intentionally unawaited because renderPrompt is sync.
        void showClass0Menu(ctx);
    },
});

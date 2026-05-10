import { Menu } from '@twnr/shared';
import { showClass0Menu } from '../display-port.js';
import { registerMenu } from './types.js';

registerMenu(Menu.Class0, {
    renderPrompt(ctx) {
        void showClass0Menu(ctx);
    },
});

import { Menu } from '@twnr/shared';
import { showSectorPrompt } from '../display.js';
import { registerMenu } from './types.js';

registerMenu(Menu.Sector, {
    renderPrompt: showSectorPrompt,
});

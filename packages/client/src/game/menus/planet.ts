import { Menu } from '@twnr/shared';
import { showPlanetMenuOptions } from '../display-planet.js';
import { registerMenu } from './types.js';

registerMenu(Menu.Planet, {
    renderPrompt: showPlanetMenuOptions,
});

import { Menu } from '@twnr/shared';
import { showShipyardsMenu } from '../display-starbase.js';
import { registerMenu } from './types.js';

registerMenu(Menu.Shipyards, {
    renderPrompt: showShipyardsMenu,
});

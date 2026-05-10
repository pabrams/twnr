import { Menu } from '@twnr/shared';
import { showShipyardsClass0Menu } from '../display-starbase.js';
import { registerMenu } from './types.js';

registerMenu(Menu.ShipyardsClass0, {
    renderPrompt: showShipyardsClass0Menu,
});

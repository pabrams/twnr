import { Menu } from '@twnr/shared';
import { showShipyardsClass0Menu } from '../display-starbase.js';
import { registerMenu } from './types.js';

// Shipyards class-0 buy menu — fully migrated. The choose_holds /
// choose_drones / choose_shields routines (in shipyards-routines.ts)
// figure out which qty menu to enter based on ctx.world.mode, since
// they're shared with the in-port class0 menu.
registerMenu(Menu.ShipyardsClass0, {
    renderPrompt: showShipyardsClass0Menu,
});

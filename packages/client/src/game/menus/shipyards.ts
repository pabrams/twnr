import { Menu } from '@twnr/shared';
import { showShipyardsMenu } from '../display-starbase.js';
import { registerMenu } from './types.js';

// Shipyards menu — fully migrated. Routines in shipyards-routines.ts;
// back / help_menu in common-routines.ts.
registerMenu(Menu.Shipyards, {
    renderPrompt: showShipyardsMenu,
});

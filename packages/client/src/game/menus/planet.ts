import { Menu } from '@twnr/shared';
import { showPlanetMenuOptions } from '../display-planet.js';
import { registerMenu } from './types.js';

// Planet menu (non-Earth) — fully migrated. take_colonists,
// leave_colonists, planet_display, destroy_planet, leave_planet routines
// in planet-routines.ts; help_menu in common-routines.ts. Empty Enter
// fires planet_display via the `<enter>` keyPattern row.
registerMenu(Menu.Planet, {
    renderPrompt: showPlanetMenuOptions,
});

import { Menu } from '@twnr/shared';
import { showPlanetMenuOptions } from '../display-planet.js';
import { registerMenu } from './types.js';

// Earth planet menu — fully migrated. take_colonists / leave_colonists
// are handled by the same routines as the regular planet menu (in
// planet-routines.ts); they branch on ctx.world.mode to skip the
// commodity-pick step (Earth defaults to fuel). leave_planet routine in
// the same file.
registerMenu(Menu.PlanetEarth, {
    renderPrompt: showPlanetMenuOptions,
});

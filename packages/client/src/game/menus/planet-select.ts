import { ClientMsgType, Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { STARBASE } from '../messages/index.js';
import { echoCommand } from '../display.js';
import { showPlanetSelectMenu } from '../display-starbase.js';
import { registerMenu, registerMenuRoutine, getMenuArgs } from './types.js';

registerMenu(Menu.PlanetSelect, {
    renderPrompt(ctx) {
        const args = getMenuArgs(ctx, Menu.PlanetSelect);
        if (args) showPlanetSelectMenu(ctx, args.planets);
        ctx.io.term.write(render(STARBASE.planetSelectPrompt));
    },
});

registerMenuRoutine(Menu.PlanetSelect, 'select_planet', (ctx, line) => {
    const idx = parseInt(line, 10) - 1;
    const planets = getMenuArgs(ctx, Menu.PlanetSelect)?.planets ?? null;
    if (planets && idx >= 0 && idx < planets.length) {
        echoCommand(ctx, 'landOnPlanet');
        ctx.io.sendMsg({ type: ClientMsgType.LandOnPlanet, planetId: planets[idx].id });
    }
});

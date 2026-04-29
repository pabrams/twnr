import { ClientMsgType, Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { NOTIFY } from '../messages/index.js';
import { echoCommand } from '../display.js';
import { registerMenu, getMenuArgs } from './types.js';

// PlanetSelect has no `renderPrompt`: the picker is rendered via a result
// handler (LandResult) that lists the landable planets.
registerMenu(Menu.PlanetSelect, {
    input(ctx, line) {
        if (line.toLowerCase() === 'q') {
            echoCommand(ctx, 'planetSelectBack');
            ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
            return;
        }
        const idx = parseInt(line, 10) - 1;
        const planets = getMenuArgs(ctx, Menu.PlanetSelect)?.planets ?? null;
        if (planets && idx >= 0 && idx < planets.length) {
            echoCommand(ctx, 'landOnPlanet');
            ctx.io.sendMsg({ type: ClientMsgType.LandOnPlanet, planetId: planets[idx].id });
        } else {
            ctx.io.term.writeln(render(NOTIFY.invalidSelection));
        }
    },
});

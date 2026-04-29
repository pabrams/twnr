import { ClientMsgType, Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { NOTIFY } from '../messages/index.js';
import { echoCommand } from '../display.js';
import { registerMenu } from './types.js';

// PlanetSelect has no `enter`: the picker is rendered via a result handler
// (LandResult) in connection.ts that lists the landable planets.
registerMenu(Menu.PlanetSelect, {
    input(ctx, line) {
        if (line.toLowerCase() === 'q') {
            echoCommand(ctx, 'planetSelectBack');
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
            return;
        }
        const idx = parseInt(line, 10) - 1;
        const planets = ctx.landablePlanets;
        if (planets && idx >= 0 && idx < planets.length) {
            echoCommand(ctx, 'landOnPlanet');
            ctx.sendMsg({ type: ClientMsgType.LandOnPlanet, planetId: planets[idx].id });
        } else {
            ctx.term.writeln(render(NOTIFY.invalidSelection));
        }
    },
});

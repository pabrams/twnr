import { ClientMsgType, Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { NOTIFY } from '../messages/index.js';
import { echoCommand } from '../display.js';
import { showPlanetSpecs, showPlanetDetail } from '../display-computer.js';
import { letterToIndex } from '../display-starbase.js';
import { registerMenu } from './types.js';

registerMenu(Menu.PlanetSpecs, {
    renderPrompt(ctx) {
        // showPlanetSpecs is async (loads planet configs); renderPrompt
        // signature is sync so the promise is intentionally unawaited.
        void showPlanetSpecs(ctx);
    },
    input(ctx, line) {
        if (line.toLowerCase() === 'q') {
            echoCommand(ctx, 'planetSpecsBack');
            ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Computer });
            return;
        }
        const idx = letterToIndex(line);
        if (ctx.catalogs.planets && idx >= 0 && idx < ctx.catalogs.planets.length) {
            showPlanetDetail(ctx, ctx.catalogs.planets[idx]);
        } else {
            ctx.io.term.writeln(render(NOTIFY.invalidSelection));
        }
    },
});

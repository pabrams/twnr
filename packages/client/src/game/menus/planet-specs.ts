import { ClientMsgType, Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { NOTIFY } from '../messages/index.js';
import { echoCommand } from '../display.js';
import { showPlanetSpecs, showPlanetDetail } from '../display-computer.js';
import { letterToIndex } from '../display-starbase.js';
import { registerMenu } from './types.js';

registerMenu(Menu.PlanetSpecs, {
    enter(ctx) {
        // showPlanetSpecs is async (loads planet configs); enter signature
        // is sync so the promise is intentionally unawaited.
        void showPlanetSpecs(ctx);
    },
    input(ctx, line) {
        if (line.toLowerCase() === 'q') {
            echoCommand(ctx, 'planetSpecsBack');
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Computer });
            return;
        }
        const idx = letterToIndex(line);
        if (ctx.planetConfigs && idx >= 0 && idx < ctx.planetConfigs.length) {
            showPlanetDetail(ctx, ctx.planetConfigs[idx]);
        } else {
            ctx.term.writeln(render(NOTIFY.invalidSelection));
        }
    },
});

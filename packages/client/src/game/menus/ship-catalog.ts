import { ClientMsgType, Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { NOTIFY } from '../messages/index.js';
import { echoCommand } from '../display.js';
import { showShipCatalog, showShipDetail, showShipInterestPrompt } from '../display-computer.js';
import { letterToIndex } from '../display-starbase.js';
import { registerMenu } from './types.js';

registerMenu(Menu.ShipCatalog, {
    enter(ctx) {
        // showShipCatalog is async (loads ship configs); the registered
        // enter signature is sync, so the promise is intentionally unawaited.
        void showShipCatalog(ctx);
    },
    input(ctx, line) {
        const lower = line.toLowerCase();
        if (lower === 'q') {
            echoCommand(ctx, 'shipCatalogBack');
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Computer });
            return;
        }
        if (lower === '?') {
            void showShipCatalog(ctx);
            showShipInterestPrompt(ctx);
            return;
        }
        const idx = letterToIndex(line);
        if (ctx.shipConfigs && idx >= 0 && idx < ctx.shipConfigs.length) {
            showShipDetail(ctx, ctx.shipConfigs[idx]);
            showShipInterestPrompt(ctx);
        } else {
            ctx.term.writeln(render(NOTIFY.invalidSelection));
            showShipInterestPrompt(ctx);
        }
    },
});

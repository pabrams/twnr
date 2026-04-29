import { ClientMsgType, Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { NOTIFY } from '../messages/index.js';
import { echoCommand } from '../display.js';
import { showShipCatalog, showShipDetail, showShipInterestPrompt } from '../display-computer.js';
import { letterToIndex } from '../display-starbase.js';
import { registerMenu } from './types.js';

registerMenu(Menu.ShipCatalog, {
    renderPrompt(ctx) {
        // showShipCatalog is async (loads ship configs); the registered
        // renderPrompt signature is sync, so the promise is intentionally
        // unawaited.
        void showShipCatalog(ctx);
    },
    input(ctx, line) {
        const lower = line.toLowerCase();
        if (lower === 'q') {
            echoCommand(ctx, 'shipCatalogBack');
            ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Computer });
            return;
        }
        if (lower === '?') {
            void showShipCatalog(ctx);
            showShipInterestPrompt(ctx);
            return;
        }
        const idx = letterToIndex(line);
        if (ctx.catalogs.ships && idx >= 0 && idx < ctx.catalogs.ships.length) {
            showShipDetail(ctx, ctx.catalogs.ships[idx]);
            showShipInterestPrompt(ctx);
        } else {
            ctx.io.term.writeln(render(NOTIFY.invalidSelection));
            showShipInterestPrompt(ctx);
        }
    },
});

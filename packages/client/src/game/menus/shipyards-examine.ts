import { ClientMsgType, Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { NOTIFY } from '../messages/index.js';
import { echoCommand } from '../display.js';
import { showShipExamineList, letterToIndex } from '../display-starbase.js';
import { showShipDetail, showShipInterestPrompt } from '../display-computer.js';
import { registerMenu } from './types.js';

registerMenu(Menu.ShipyardsExamine, {
    renderPrompt: showShipExamineList,
    input(ctx, line) {
        const lower = line.toLowerCase();
        if (lower === 'q') {
            echoCommand(ctx, 'shipyards');
            ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Shipyards });
            return;
        }
        if (lower === '?') {
            showShipExamineList(ctx);
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
